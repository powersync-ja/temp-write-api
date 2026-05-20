# Row-Level Security across both write-API demos

## Problem

Both PoCs in this repo follow the same shape: a client posts a CRUD transaction to a write endpoint, the endpoint calls into a shared-style Postgres persister, and the persister opens a `pg` pool connection and runs `INSERT` / `UPDATE` / `DELETE` statements inside a single transaction.

That pool connects as a privileged Postgres user (`postgres` in both setups). Postgres RLS does not apply to superusers or table owners, so every write today bypasses RLS regardless of what policies are on the tables. The write path therefore implicitly trusts whatever the client sends — including row-ownership columns like `lists.owner_id`. For a stack pitched at Supabase users (who expect RLS to be the source of truth for write authorization), this is the wrong default.

We want the persister to apply the same RLS rules Postgres would apply to a direct client connection: the request must run as an unprivileged role, with the invoking user's JWT claims visible to policies via `request.jwt.claims`. The auth identity already exists in both demos — what is missing is the plumbing that carries it from the HTTP layer into each Postgres transaction.

Two secondary constraints shape the design:

1. **Keep the persister implementations symmetric.** The standalone backend and the Supabase edge function each have their own copy of `postgres-persistance.ts`; they should stay close to identical so the shared logic does not fork.
2. **Don't make RLS mandatory.** The PG persister must remain usable without RLS — both as an explicit service-role / background-job path, and because the other persisters in the backend (`mongo`, `mysql`, `mssql`) have no RLS concept and need to keep working under the same `Persister` interface.

## Mechanism

Postgres only enforces RLS when the current role isn't a superuser or table owner. The standard Supabase pattern is to keep the pool connected as `postgres` but, inside each request transaction, drop to `authenticated` with `SET LOCAL ROLE` and stash the JWT payload in a transaction-local GUC so `auth.uid()` / `auth.jwt()` can read it.

When an auth context is supplied, each `updateBatch(...)` transaction grows three statements at the top:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', $1, true);  -- $1 = JSON-encoded JWT payload
-- existing INSERT / UPDATE / DELETE statements unchanged
COMMIT;
```

Both `SET LOCAL` and `set_config(..., true)` are transaction-scoped, so this works under the Supabase transaction pooler (Supavisor port 6543) as well as a direct connection. No session-level state is required.

When `updateBatch` is called *without* an auth context, those two statements are simply skipped — the transaction runs exactly as it does today, as `postgres`, with RLS bypassed.

## Optionality and the other persisters

`AuthContext` is an optional second parameter on `Persister.updateBatch`. Concretely:

- **PG persister with `auth`:** RLS-enforcing path. `SET LOCAL ROLE` + `set_config` are emitted; policies run.
- **PG persister without `auth`:** same as today. No role switch, no claims GUC, RLS bypassed. Useful for service-role / migration / background-job callers, and for any deployment that hasn't enabled RLS on its tables.
- **Mongo / MySQL / MSSQL persisters:** they implement the same `Persister` interface and accept the optional second arg, but ignore it. RLS is a Postgres concept; there's no equivalent to translate to.

In practice this means the only callers that need to thread an `AuthContext` are the two HTTP entrypoints (`backend/src/api/data.ts` and `supabase/functions/data/index.ts`). Everything else — the persister factory map, the non-PG persisters, scripts that call the persister directly — keeps working with no changes.

## End-to-end per demo

### Demo 1 (`backend/`, standalone Node)

- Frontend (`DemoConnector` / `OpenAPITransport`) must send the JWT issued by `/api/auth/token` as `Authorization: Bearer …` on every `POST /api/data`. It already fetches that token for PowerSync; the same token is reused.
- Express handler (`src/api/data.ts`) verifies the JWT against the local JWKS (the keys already loaded in `src/api/auth.ts`), decodes the payload, and calls `updateBatch(crud, { claims, role: 'authenticated' })`.
- If the request arrives without an `Authorization` header (e.g. during local debugging), the handler can choose to either reject or fall through to `updateBatch(crud)` — that decision is per-route policy, not a persister concern.
- Postgres (`init-scripts/setup.sql`) gets the bits Supabase ships with for free: an `authenticated` role, an `auth` schema with `auth.uid()`, table grants, RLS enabled, and policies. Identical policy shape to the Supabase demo so the two stay symmetric.

### Demo 2 (`supabase-example/`, Supabase Edge Function)

- Frontend (`SupabaseConnector.uploadData`) already calls `this.client.functions.invoke('data', { body })`. `supabase-js` attaches the session access token automatically — no client change.
- Edge function (`supabase/functions/data/index.ts`) reads `Authorization` from the incoming request. The Supabase platform has already verified the JWT (`verify_jwt = true` is the default in `config.toml`), so for the PoC we just base64-decode the payload and pass it through to the persister.
- A new migration enables RLS on `lists` and `todos` and adds policies. `authenticated`, `auth.uid()`, and `auth.jwt()` are already provided by Supabase, so no helper definitions are needed.

## Persister changes (shared shape)

Both `backend/src/persistance/postgres/postgres-persistance.ts` and `supabase-example/supabase/functions/data/persistance/postgres-persistance.ts` change identically.

`types.ts` in each repo gains:

```ts
export interface AuthContext {
  /** Decoded JWT payload — written to request.jwt.claims for the duration of the tx. */
  claims: Record<string, unknown>;
  /** Postgres role to SET LOCAL to. Defaults to 'authenticated'. */
  role?: string;
}

export interface Persister {
  updateBatch(batch: CrudEntry[], auth?: AuthContext): Promise<void>;
}
```

Inside `createPostgresPersister`, after `BEGIN` and before the CRUD loop:

```ts
if (auth) {
  await client.query(`SET LOCAL ROLE ${escapeIdentifier(auth.role ?? 'authenticated')}`);
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify(auth.claims),
  ]);
}
```

PUT / PATCH / DELETE blocks and error mapping are unchanged. The only remaining diff between the two persister files is the existing `Pool` construction (URL parsing vs. connection string + `max: 1`), which stays as-is.

The role name is wrapped in `escapeIdentifier` and must come from server config — never from request input.

In `backend/src/persistance/persister-factories.ts` and the other persister files, the signature widens to accept `auth?: AuthContext`. The non-PG implementations simply don't reference it.

## SQL deltas

### `backend/init-scripts/setup.sql` — additions

```sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end$$;

create schema if not exists auth;
create or replace function auth.uid() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.lists, public.todos to authenticated;

alter table public.lists enable row level security;
alter table public.todos enable row level security;

create policy lists_owner on public.lists
  for all to authenticated
  using (owner_id::text = auth.uid())
  with check (owner_id::text = auth.uid());

create policy todos_via_list on public.todos
  for all to authenticated
  using (exists (
    select 1 from public.lists l where l.id = todos.list_id and l.owner_id::text = auth.uid()
  ))
  with check (exists (
    select 1 from public.lists l where l.id = todos.list_id and l.owner_id::text = auth.uid()
  ));
```

The cast to `text` keeps the helper signature simple (no JSON-to-uuid coercion). Switch to `returns uuid` and drop the casts if preferred — pick one and apply consistently.

### `supabase-example/supabase/migrations/<timestamp>_enable_rls.sql` — new file

```sql
alter table public.lists enable row level security;
alter table public.todos enable row level security;

create policy lists_owner on public.lists
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy todos_via_list on public.todos
  for all to authenticated
  using (exists (
    select 1 from public.lists l where l.id = todos.list_id and l.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.lists l where l.id = todos.list_id and l.owner_id = auth.uid()
  ));
```

`owner_id` is already `uuid` here and Supabase's `auth.uid()` returns `uuid`, so no casts needed.

## Concrete file changes

### Shared (applied independently in each repo)

- `types.ts` in each repo: add `AuthContext`, widen `Persister.updateBatch` signature.
- `postgres-persistance.ts` in each repo: conditionally emit `SET LOCAL ROLE` + `set_config('request.jwt.claims', …)` right after `BEGIN`.
- Backend only — `src/persistance/{mongo,mysql,mssql}/*-persistance.ts`: widen the signature to accept (and ignore) the optional `auth` arg so they continue to satisfy the `Persister` interface.

### Demo 1 — `backend/`

- `src/api/auth.ts`: export a `verifyJwt(token)` helper that returns the decoded payload, using the existing JWKS keys.
- `src/middleware/`: new `auth.ts` middleware that reads `Authorization: Bearer …`, calls `verifyJwt`, and attaches `req.auth = { claims }`. Mount before `/api/data`.
- `src/api/data.ts`: pass `req.auth` into `updateBatch(req.body.crud, req.auth)`.
- `frontend/src/library/powersync/DemoConnector.ts` + `OpenAPITransport.ts`: cache the token fetched in `fetchCredentials` and send it as `Authorization: Bearer …` on `/api/data` calls.
- `init-scripts/setup.sql`: the additions above.

### Demo 2 — `supabase-example/`

- `supabase/functions/data/index.ts`: read `Authorization` header, base64-decode the JWT payload, pass `{ claims, role: 'authenticated' }` into `updateBatch`. No re-verification needed in the PoC — the platform already verified.
- `supabase/migrations/<timestamp>_enable_rls.sql`: the migration above.
- `supabase-example/frontend/`: no changes — `supabase-js` already attaches the access token to `functions.invoke`.

## Critical files

- `backend/src/persistance/postgres/postgres-persistance.ts`
- `backend/src/api/data.ts`
- `backend/init-scripts/setup.sql`
- `backend/src/api/auth.ts`
- `supabase-example/supabase/functions/data/persistance/postgres-persistance.ts`
- `supabase-example/supabase/functions/data/index.ts`
- `supabase-example/supabase/migrations/<new>.sql`

## Gotchas

- **`SET LOCAL ROLE` requires membership.** In both demos the pool connects as `postgres` (superuser), which can switch to any role — fine for PoC. If the app role ever stops being a superuser, it must be `GRANT`ed `authenticated` first.
- **RLS now enforces `owner_id`.** Today the client picks its own `owner_id`. Once `WITH CHECK (owner_id = auth.uid())` is in place, any forged owner is blocked. Confirm the create-list path uses the locally signed-in user id.
- **PowerSync JWT claim names.** Both demos put the user id in `sub`. As long as the persister always reads `sub`, policies are identical between repos (modulo the `uuid` vs `text` choice in `auth.uid()`).
- **Transaction pooler.** All state — role and `request.jwt.claims` — is set with `LOCAL` / `is_local = true`, so the pattern is safe on the Supabase Transaction Pooler. Resist moving any of it to session-level configuration.
- **Sync rules are separate.** RLS only governs the write path. Down-sync filtering is controlled by `sync_rules.yaml` (the Supabase demo already filters via `auth.user_id()`; the standalone demo's `SELECT * FROM lists` does not). Out of scope here, but worth filing as a follow-up so the two paths don't drift.
- **RLS-on tables vs. no-auth callers.** If RLS is enabled on a table and a caller invokes `updateBatch` without an `AuthContext`, the call still runs as the superuser pool user and therefore still bypasses RLS. That is the intended escape hatch, but it means "table has RLS" alone is not a safety net — the entrypoint has to decide whether to pass auth. Document this on the persister.

## Verification

1. Apply DB changes:
   - Backend demo: `docker-compose down -v && docker-compose up` to re-run `setup.sql`.
   - Supabase demo: `supabase db reset` to apply the new migration.
2. Sign in (or generate a token via `/api/auth/token?user_id=…`). Confirm the network request to the write endpoint carries `Authorization: Bearer …`.
3. Happy path: create a list, add a todo, toggle, delete — all succeed; rows land in Postgres.
4. RLS guard rail: use a second user (or hand-craft a JWT with a different `sub`) and attempt to insert a list with `owner_id` set to user A's id while authenticated as user B. Expect the insert to be rejected by the `WITH CHECK` clause. Same exercise for `todos` via a list owned by another user.
5. Service-role / no-auth path: call the persister directly from a script without an `AuthContext` and confirm it still writes successfully — confirms the optional path hasn't regressed.
6. Non-PG persisters: smoke-test mongo / mysql / mssql via `DATABASE_TYPE` swaps to confirm the signature widening hasn't broken them.

## Future work (not in this PR)

- Verify the Supabase JWT inside the edge function against `SUPABASE_JWT_SECRET` rather than trusting the platform's pre-validation. Belt and braces; useful if `verify_jwt = false` is ever set.
- Switch the standalone backend's app role away from `postgres` to a least-privileged role granted membership in `authenticated`, so a missing `SET LOCAL ROLE` would still fail safe.
- Bring sync-rule filtering on the standalone demo to parity with the Supabase one so down-sync is also user-scoped.
- Optional `requireAuth: true` flag on the PG persister factory that turns a missing `AuthContext` into a hard error, for deployments that want to disallow the service-role fallthrough.
