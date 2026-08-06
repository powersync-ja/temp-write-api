import type { z } from 'zod';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// Mutators are typed against the Postgres schema; the client casts its sqlite schema/tx
// to these at the call site.
export type AppSchema = typeof import('../schema/todos.pg.js');

// Both a db and a transaction handle satisfy PgDatabase.
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
