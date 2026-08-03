import type { z } from 'zod';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// The canonical schema type is the Postgres table set. The mutator bodies are written
// and type-checked against these types; the client casts its (structurally aligned)
// sqlite schema to this at the injection site. See "Cross-dialect typing" in
// drizzle-plan.md for why we type against one dialect rather than a shared interface.
export type AppSchema = typeof import('../schema/todos.pg.js');

// A transaction handle. `PgTransaction` extends `PgDatabase`, and `NodePgDatabase`
// extends `PgDatabase`, so both a top-level db and a `db.transaction(tx => ...)` handle
// are assignable here — the mutator body only touches the shared insert/update/delete API.
export type AppTx = PgDatabase<PgQueryResultHKT, AppSchema>;

export interface MutatorCtx {
  tx: AppTx;
  schema: AppSchema;
  userId: string;
}

export interface Mutator<S extends z.ZodType = z.ZodType> {
  args: S;
  run: (args: z.infer<S>, ctx: MutatorCtx) => Promise<void>;
}

export type SharedMutators = Record<string, Mutator>;
