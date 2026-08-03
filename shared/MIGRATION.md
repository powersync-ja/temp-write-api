# shared/ — lightweight now, workspace later

This directory holds the **isomorphic mutator** code imported by *both* `frontend/`
(SQLite via PowerSync) and `backend/` (Postgres): the Drizzle table definitions
(`schema/*.ts`, one file per dialect), the mutator definitions (`mutators/*.ts`), and
the shared runtime types (`mutators/runtime.ts`).

## Current layout (deliberately lightweight)

- **No pnpm workspace.** `frontend/` and `backend/` remain two independent projects.
- Both import shared code via a `@shared/*` tsconfig path alias
  (`frontend/tsconfig.json`) / relative `../../../shared/*.js` imports (`backend`, ESM
  Node16). The frontend also needs the Vite `resolve.alias` for `@shared`.
- The shared module's own dependencies (`drizzle-orm`, `zod`, and — for the backend's
  Drizzle Postgres driver types — `pg`, `@types/pg`) live in the **root**
  `package.json`, so files under `shared/` (which sit outside both projects'
  `node_modules`) can resolve them by walking up to the repo root. The root
  `package.json` also sets `"type": "module"` so Node16 treats `shared/*.ts` as ESM.

## The sharp edge we hit (why a workspace is the real fix)

Drizzle's types are generic and **package-identity-sensitive**: two physical copies of
`drizzle-orm@0.45.2` produce mutually-unassignable types (`ExtractTablesWithRelations`,
`SQLiteColumn`, `SQL`, …), even at the same version. In the no-workspace layout we get
multiple copies because:

- `shared/` resolves `drizzle-orm` from the **root** copy.
- Each project also has (or pulls in) its **own** copy.
- pnpm **peer-keys** copies: because the root declares `pg`, its drizzle-orm is the
  variant `drizzle-orm@0.45.2_@types+pg_pg`, distinct from the plain
  `drizzle-orm@0.45.2` that `@powersync/drizzle-driver` uses on the client.

We stabilised the lightweight layout with two moves:

1. **Backend:** removed backend's own `drizzle-orm` so backend and `shared/` both use the
   single root (pg-keyed) copy → backend type-checks with **no cast**.
2. **Frontend:** added a direct plain `drizzle-orm` dep so app code and the PowerSync
   driver share one copy; the residual gap to `shared/`'s (root, pg-keyed) copy is
   bridged by the **single cast** already required for the SQLite-vs-Postgres *dialect*
   difference (`frontend/src/library/mutators/sharedClient.ts`).

The cast's *dialect* half is inherent to isomorphic mutators; its *package-identity*
half is pure packaging accident.

## When/how to migrate to a workspace

Migrate when the casts/root-deps friction outgrows its value (e.g. more shared modules,
more dialects, or wanting compile-time client-schema checks). Steps:

1. Add root `pnpm-workspace.yaml` with `packages: ['frontend', 'backend', 'shared']`.
2. Give `shared/` its own `package.json` (`@write-api/shared`) declaring `drizzle-orm`
   + `zod` as **dependencies** and building/exporting `./schema/*`, `./mutators`.
3. Depend on it from both projects via `"@write-api/shared": "workspace:*"`; drop the
   `@shared/*` path aliases (or keep them pointing at the package).
4. Hoist a **single** `drizzle-orm` (pnpm dedupes across the workspace; use
   `pnpm.overrides` if peer-keying still splits it). This removes the package-identity
   half of the client cast — leaving only the intrinsic dialect assertion.
5. Optionally adopt `DrizzleAppSchema` to derive the PowerSync client schema from the
   shared sqlite tables (replacing `frontend/src/library/powersync/AppSchema.ts`).
