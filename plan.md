Next Prototyping Steps for Write API

Context

The tracer bullet is in place: JS web client -> JS/Express backend -> Postgres, with an OpenAPI spec, 4 database
persisters (Postgres, MySQL, MSSQL, MongoDB), a demo todo app frontend, and typed client/server code generated from the
spec. The happy path works end-to-end for simple CRUD operations.

The question: what should be prototyped next?

---

Prototyping List

1.  Auto Type Mapper (SQLite <-> Source DB)

The proposal identifies type mapping as a major pain point and support issue. Currently, json_populate_record in the
Postgres persister does implicit casting, but there's no explicit, configurable mapping layer. Prototype:

- A mapper interface that translates SQLite's 3 types (INTEGER, REAL, TEXT) to the source DB's type system
- A default "1-1" mapper for Postgres (e.g., TEXT -> TEXT, INTEGER -> INTEGER/BIGINT, REAL -> DOUBLE PRECISION)
- Column-level type override configuration (e.g., "this TEXT column is actually a TIMESTAMP", "this TEXT column is
  actually JSONB")
- Test with the existing todo app schema to validate the flow

The MongoDB persister already has a rudimentary version of this (mongo-schema.ts with type converters), which could inform
the general interface.

2.  Custom Type Mapper / Schema Introspection

Building on #1, prototype the ability to introspect the source DB schema and auto-derive the mapping:

- Query information_schema.columns (Postgres) to get target column types
- Auto-generate a mapping config from source DB schema + PowerSync SQLite schema
- Handle the common custom types: JSON/JSONB, arrays, enums, timestamps, booleans, UUIDs

3.  Fatal Error Handling on the Client (Dead-Letter / Skip Behavior)

Currently DemoConnector.ts:99-100 logs fatal errors but does nothing — the transaction is neither completed nor skipped,
which means the queue stalls. Prototype:

- What should the client do when it gets a fatal_error response? Options: skip the transaction (call complete), move to a
  local dead-letter table, surface to the user via a callback/event
- A client-side error callback/hook mechanism so the app can react to fatal errors
- Whether previous_values (already in the spec) should be used to enable client-side conflict resolution

4.  Server-Side Dead-Letter Queue

The proposal calls for a DLQ with exposed hooks for developers. Prototype:

- A dead_letter table schema (original operation, error code, timestamp, metadata)
- Persisting failed operations to the DLQ instead of just returning the error
- An API endpoint to list/inspect/retry/discard dead-letter entries
- Add to the OpenAPI spec

5.  Auth on the Write Endpoint

The /api/data endpoint currently has no authentication. The proposal notes that auth is needed but the connector isn't
responsible for it. Prototype:

- JWT validation middleware on /api/data (verify the same tokens issued by /api/auth/token)
- Extract user_id from the token instead of trusting the client
- Consider how this interacts with the checkpoint endpoint (which currently takes user_id in the body)

6.  Batch/Multi-Transaction Upload

The DemoConnector only uses getNextCrudTransaction() (one transaction at a time). The proposal discusses batches.
Prototype:

- Update the OpenAPI spec to support an array of transactions (or use getCrudBatch)
- Update the client connector to send multiple transactions in one request
- Update the backend to process them (all-or-nothing vs. per-transaction rollback semantics)
- Measure performance difference vs. single-transaction uploads

7.  Client-Side Upload Library Extraction

The proposal envisions @powersync/upload as a reusable client library. Prototype:

- Extract the upload logic from DemoConnector.ts into a standalone module
- Define the interface: what does the user configure (backend URL, auth, error handlers) vs. what's automatic
- Make the DemoConnector a thin wrapper around this library
- Consider what the "zero config" experience looks like

8.  Server-Side Router/Handler Extraction

The proposal envisions @powersync/backend-router, @powersync/backend-translator-_, @powersync/backend-persister-_.
Prototype:

- Define the boundaries between router, translator (mapper), and persister
- Extract the Express route handler into a framework-agnostic module
- Make the persister pluggable without the factory pattern requiring all drivers to be installed
- Consider: is the router/translator/persister split the right decomposition, or is translator+persister better as one
  unit?

9.  Response Protocol Refinement

The existing TODO calls this out. Prototype:

- Per-operation status in the response (currently the response is per-transaction, but what if 1 of 10 operations fails?)
- Whether retry_after_ms should have a default/recommended value
- Whether the response should echo back client_id of the failed operation for client-side correlation
- Partial success semantics: if the transaction rolls back, should the response indicate which operation caused it
  (currently it does via failed_operation, but only for fatal errors)

10. OpenAPI Codegen for Another Language

The proposal's big bet is that a standard protocol enables cross-language interop. Prototype:

- Generate a client stub for one other language (Kotlin or Dart, as these are key PowerSync client platforms)
- Generate server scaffolding for one other language (Python or Go, as common backend choices)
- Evaluate the quality of generated code — is it usable out of the box or does it need heavy customization?
- Document the codegen workflow

11. Large Payload / Streaming

The proposal flags this as potentially low-priority but worth understanding. Prototype:

- Determine realistic payload size limits (how big can a transaction get in practice?)
- If needed, prototype chunked upload (client sends parts, server assembles)
- This would inform the REST vs. WebSocket vs. gRPC decision

12. MongoDB Persister Completion

The MongoDB persister has explicit TODOs for batch operations and transactions. Prototype:

- Use MongoDB bulk write operations instead of looping
- Wrap in a MongoDB transaction (replica set is already configured in docker-compose)
- Generalize the schema/type conversion beyond the hardcoded todo schema

---

Suggested Priority Order

High value, foundational (do these first — they inform everything else):

1.  Fatal error handling on the client (#3) — the current stall behavior is a showstopper
2.  Auth on the write endpoint (#5) — security baseline
3.  Auto type mapper (#1) — core DX improvement, the main reason users struggle

High value, builds on foundations: 4. Response protocol refinement (#9) — nail the protocol before generating code for other languages 5. Server-side DLQ (#4) — pairs with #3 6. Client-side library extraction (#7) — needed before spreading to other client platforms

Validation / spread-out: 7. Codegen for another language (#10) — validates the protocol is language-agnostic 8. Server-side extraction (#8) — needed before spreading to other server platforms 9. Batch upload (#6) — performance optimization

Lower priority / research: 10. Schema introspection (#2) — nice DX but not blocking 11. Large payloads (#11) — validate whether this is a real problem 12. MongoDB completion (#12) — important but straightforward
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
