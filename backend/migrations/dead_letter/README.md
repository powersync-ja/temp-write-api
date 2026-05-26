# Dead-letter queue migrations

These scripts create the `powersync_dead_letter` table/collection that the backend writes to when a transaction fails with a non-recoverable error (constraint violations, schema mismatches, validation failures). The scripts are templates — copy them into your own migration workflow and adapt as needed.

## Applying

| Source DB | Command |
| --- | --- |
| Postgres | `psql "$DATABASE_URI" -f postgres.sql` |
| MySQL | `mysql --defaults-extra-file=... < mysql.sql` |
| MSSQL | `sqlcmd -S ... -i mssql.sql` |
| MongoDB | `mongosh "$DATABASE_URI" mongo.js` |

## What's in a dead-letter row

Each row carries the full uploaded transaction plus a pointer to the operation that caused the rollback:

- `id` — DLQ row id (UUID).
- `transaction_id` — client-side transaction id (may be null per the wire spec).
- `crud` — JSON payload of the full `CrudEntry[]` as uploaded.
- `failed_client_id` — `CrudEntry.client_id` of the offending op.
- `failed_table`, `failed_op` — table and op type (`PUT|PATCH|DELETE`) of the offender.
- `error_code` — machine classification (`UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `SCHEMA_MISMATCH`, ...).
- `error_message` — driver-supplied human-readable detail.
- `created_at` — when the DLQ row was written.

## What's covered

Errors the server classifies as non-transient. These come back to the client as `status: 'dead_lettered'`; the client completes the transaction and the row lands here.

## What's _not_ covered

- **Stuck transient errors.** A "retryable" error (network blip, deadlock, DB unavailable) that never resolves keeps the client upload queue stuck — it does not land in the DLQ. Fix the underlying issue or build a higher-level escape hatch.
- **Mutator failures.** `/api/mutators/invoke` is a separate write channel with its own failure semantics. Not handled by this DLQ.

## MongoDB caveat

The MongoDB persister currently runs ops in a loop without wrapping them in a multi-document transaction. If op #3 of 5 fails, ops #1 and #2 are already committed. The DLQ entry still records the full transaction and the failing-op pointer, but **the entry represents intent that was partially applied** — naive replay against the same `_id` set will collide. When designing replay or resolution for Mongo, account for this.

The other persisters (Postgres, MySQL, MSSQL) wrap the batch in a real transaction, so their DLQ entries always represent a clean rollback.

## Resolution hook

`backend/src/dead-letter-hook.ts` exports an `onDeadLetter` function that fires after each DLQ row is committed. It's fire-and-forget — errors in the hook are logged and dropped; they never block the upload response. Wire it to Slack, an admin dashboard refresh, metrics, or anything else.
