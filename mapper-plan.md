# Handling JSON / arrays / bytea / custom Postgres types in the write path

## Context

PowerSync stores complex Postgres types as plain `text` columns on the client
(https://docs.powersync.com/client-sdks/advanced/custom-types-arrays-and-json):

- JSON / JSONB columns sync as JSON-encoded strings.
- Arrays (`text[]`, `uuid[]`, …) sync as the string form of a JSON array.
- Composite / custom types serialise as JSON object strings.
- Bytea is undocumented; the conventional approach is base64-as-text.

When the dev mutates such a column locally and PowerSync flushes the CRUD
queue, the values arrive in `op_data` on the server as **strings**, not as
JSON objects/arrays/buffers. The current write-api persister can't tell them
apart from regular text values, so they either fail or get silently
corrupted.

## What works today (for free)

Both the backend (`backend/src/persistance/postgres/postgres-persistance.ts:60-66`)
and the supabase-example Edge Function
(`supabase-example/supabase/functions/data/persistance/postgres-persistance.ts:56-62`)
build their INSERT/UPDATE/DELETE statements around:

```sql
WITH data_row AS (
  SELECT (json_populate_record(null::TABLE, $1::json)).*
)
INSERT INTO TABLE (...) SELECT ... FROM data_row
ON CONFLICT (id) DO UPDATE SET ...
```

`json_populate_record(null::TABLE, $1::json)` asks Postgres to materialise a
row of the target table from a JSON payload, using its own per-column input
parsers. This is the key reason the persister is schema-agnostic — it never
has to know what types the columns are.

The types that *already* round-trip correctly through this:

| PG column type                     | JSON value PG expects                  | Status |
|------------------------------------|----------------------------------------|--------|
| `text`, `varchar`, `uuid`          | string                                 | ✅ |
| `int*`, `numeric`, `float*`        | number                                 | ✅ |
| `bool`                             | boolean (also "true"/"false")          | ✅ |
| `date`, `timestamp[tz]`            | ISO string                             | ✅ |
| `json`, `jsonb`                    | a JSON object/array literal            | ✅ if the value is a real JSON object — ❌ if it's a stringified one |
| Postgres arrays (`text[]`, …)      | a JSON array                           | ✅ if real array — ❌ if stringified |
| enum                               | string                                 | ✅ |
| composite types                    | nested JSON object                     | ✅ if real object — ❌ if stringified |
| domains                            | underlying type                        | ✅ |
| `bytea`                            | hex-escape string (`\xDEADBEEF`)       | ⚠️ only that exact text format |

## The actual breakage

Because PowerSync hands us strings, the persister sees:

```json
{
  "tags":     "[\"a\",\"b\"]",
  "metadata": "{\"foo\":1}",
  "blob":     "SGVsbG8="
}
```

- `tags TEXT[]`: PG tries to parse `[\"a\",\"b\"]` as a PG array literal
  (which wants `{a,b}`) → **fails**.
- `metadata JSONB`: PG stores it as a JSON **string scalar** `"{\"foo\":1}"`
  rather than as an object → **silent corruption**.
- `blob BYTEA`: base64 isn't `\x…` format → **fails**.

The current doc-recommended workaround is `jsonDecode` in `uploadData` per
column. That works but pushes schema knowledge into every app's connector,
and offers nothing for bytea.

## Existing extension surface

`createPostgresPersister` already accepts an `EntryMapper`
(`backend/src/mapping/types.ts:14`). The Mongo side uses this exact hook to
do type coercion: `mongoMapper`
(`backend/src/mapping/mongo.ts`) walks `op_data` through a declarative
per-table schema (`backend/src/persistance/mongo/mongo-schema.ts`) and
converts `string → Date`, `string → boolean`, etc. The shape is already in
place — the PG path just doesn't use it (it falls back to `defaultMapper`).

The supabase-example connector
(`supabase-example/frontend/src/library/powersync/SupabaseConnector.ts:103-114`)
spreads `op.opData` straight into the body with no coercion at all. The
demo doesn't expose the problem only because its schema is entirely
`text/uuid/timestamptz/bool` columns.

## Strategies

Three places to intervene, ordered client → DB:

### 1. Client `uploadData` (status quo)

Dev calls `JSON.parse` for known JSON / array columns inside `uploadData`,
and base64-decodes bytea by hand.

- **Pros:** simple, works today, no server change.
- **Cons:** schema knowledge duplicated in every app; nothing automatic;
  bytea convention has to be invented per app.

Keep this on the table as the no-server-change fallback, but it's not where
we want the default to live.

### 2. Server-side mapper (recommended default)

Both flavours fit the existing `EntryMapper` extension point.

**2a. PG-introspection mapper.** At startup (or with a TTL cache), query
`information_schema.columns` for the tables being written. Cache
`{table → {column → {data_type, udt_name}}}`. In the mapper, before handing
the payload to `json_populate_record`:

- if column is `ARRAY`, `json`, `jsonb`, or `USER-DEFINED`
  (composite / enum / domain) AND value is a string → `JSON.parse(value)`;
- if column is `bytea` AND value is a string → assume base64 and rewrite to
  `'\\x' + Buffer.from(v, 'base64').toString('hex')`;
- everything else: pass through untouched — `json_populate_record` already
  handles it.

The SQL doesn't change. The mapper only normalises the shape so PG's own
parsers can do the rest.

- **Pros:** zero per-table dev work; generic across any PG schema; consistent
  with how the Mongo path works.
- **Cons:** schema cache invalidation on DDL. For demos / dev: introspect
  once at startup. For production: TTL or LISTEN/NOTIFY on schema events.

**2b. Declarative per-table type map.** Mirror `mongoMapper`: the dev
declares which columns are JSON / array / bytea / composite, and the mapper
applies the same conversions. No DB roundtrip.

- **Pros:** explicit; no DDL race; can be code-generated from migrations or
  from the PowerSync schema.
- **Cons:** dev keeps a schema-in-app; another thing that can drift.

### 3. DB-side mapping (escape hatch)

For genuinely custom encodings — encrypted blobs, polymorphic columns,
domain-specific text-array conventions — push the transformation into
Postgres:

- **Writable view + `INSTEAD OF` triggers.** Dev creates e.g.
  `lists_writable` exposing the column in the text shape PowerSync produces;
  the trigger casts to the real types on insert/update. The client (or a
  server-side rewrite) targets the view rather than the base table. Then
  `json_populate_record(null::lists_writable, …)` Just Works because the
  view's column types match the wire shape.
- **`INSTEAD OF` triggers on the base table.** Possible but invasive — the
  trigger has to handle every column unconditionally.
- **RPC / mutators.** Per `mutators-plan.md`: dev writes the SQL, including
  casts, by hand. No generic coercion needed because the mutator body sees
  raw args. This is the right tool when the operation isn't a plain table
  write anyway.

## Recommendation

Treat **2a** as the default and **3** as the escape hatch.

- Add a thin PG-introspection coercer in front of `json_populate_record`
  inside `createPostgresPersister` (or as a `postgresMapper` factory),
  covering JSON / JSONB / arrays / composites / bytea. This is the highest-
  leverage change — it makes the 80% case "just work" and removes the most
  common foot-gun.
- For `bytea`, declare and document the convention ("strings are base64").
  Devs who need a different encoding override per-table.
- For genuinely custom types, point devs at **writable views +
  `INSTEAD OF` triggers** as the documented pattern. This keeps the
  transformation next to the schema and lets the generic write path stay
  generic.
- Mutators remain the answer when CRUD isn't the right abstraction.

## Open implementation questions

- **Wiring.** Should this be a postgres-specific wrapper around
  `defaultMapper` (composed at factory time), or a new
  `postgresMapper(uri)` factory that bundles introspection? Probably the
  latter, to make it explicit at `createPostgresPersister` callsites which
  policy is active.
- **Introspection lifecycle.** Startup-only is fine for the local
  Edge-Function dev loop (`supabase functions serve` restarts on file
  change). A deployed write-api probably wants either a TTL cache or
  `LISTEN ddl_command_end` to catch online schema changes.
- **Bytea convention.** Standardise on base64? Or offer both base64 and hex
  with a per-column hint? Default to base64 (interoperable with JS
  `atob`/`Buffer`).
- **Composite types.** `json_populate_record` recurses into composites
  automatically, but only if the nested value is a JSON object. The
  coercer therefore needs to `JSON.parse` the string and pass an object;
  it does not need to walk into the composite itself.

## Verification

1. Add an integration table to the dev DB with columns covering each case:
   `tags text[]`, `metadata jsonb`, `props json`, `flags my_enum`,
   `point (float8, float8)` composite, `blob bytea`.
2. On the client, expose each as a `text` column per the PowerSync docs;
   mutate locally and confirm `uploadData` ships stringified payloads.
3. Without the coercer, observe the failure modes documented above.
4. With the coercer enabled, confirm:
   - `text[]` round-trips as a real PG array (`SELECT array_length`).
   - `jsonb` stores as an object, not a JSON scalar string
     (`jsonb_typeof` = `'object'`).
   - Custom composite materialises with non-null subfields.
   - Bytea stores the decoded bytes (`octet_length` matches the pre-encode
     length).
5. Re-run the supabase-example demo to confirm the existing scalar-only
   schema is unaffected.

## Out of scope for this plan

- Mutator dispatch / `mutator_calls` table (see `mutators-plan.md`).
- Read-path / sync-down concerns — the PowerSync sync rules already
  control how complex types arrive on the client.
- Non-Postgres persisters (Mongo already has its own coercer; MySQL/MSSQL
  TBD).
