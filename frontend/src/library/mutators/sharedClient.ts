import { wrapPowerSyncWithDrizzle } from '@powersync/drizzle-driver';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { z } from 'zod';
import { sharedMutators, type AppSchema, type AppTx, type SharedMutators } from '@shared/mutators';
import * as sqliteSchema from '@shared/schema/todos.sqlite';

type Mutate<M extends SharedMutators> = {
  [K in keyof M]: (args: z.infer<M[K]['args']>) => Promise<void>;
};

/**
 * Runs the SAME shared mutator definitions the backend runs, but against the local
 * PowerSync SQLite database via Drizzle. Each call, in one transaction:
 *   1. inserts the `mutator_calls` intent row (funnels into PowerSync's upload queue), and
 *   2. applies the shared mutator body optimistically to the local DB.
 *
 * Generic over the mutator map (like the mutators registry) so per-mutator arg types
 * stay correlated — indexing a concrete union of arg shapes would collapse to an
 * intersection.
 */
export const createSharedMutators = <M extends SharedMutators>(
  db: AbstractPowerSyncDatabase,
  mutators: M,
  getUser: () => { userId: string }
): Mutate<M> => {
  const drizzleDb = wrapPowerSyncWithDrizzle(db, { schema: sqliteSchema });
  const mutate = {} as Mutate<M>;

  for (const key of Object.keys(mutators) as Array<keyof M & string>) {
    const m = mutators[key];
    mutate[key] = (async (rawArgs: unknown) => {
      const args = m.args.parse(rawArgs);
      const callId = uuid();
      const { userId } = getUser();

      await drizzleDb.transaction(async (tx) => {
        // Bookkeeping intent row — raw SQL (no table object) so it stays independent of
        // the shared schema's Drizzle package identity, and keeps raw SQL exposed.
        await tx.run(
          sql`INSERT INTO mutator_calls (id, name, args, created_at)
              VALUES (${callId}, ${key}, ${JSON.stringify(args)}, ${new Date().toISOString()})`
        );

        // The shared body is typed against the Postgres dialect (the canonical schema).
        // Here we invoke it with a SQLite Drizzle tx + sqlite schema. The two dialects'
        // tx/table types are not structurally assignable, so we assert at this single
        // injection boundary — safe because the column shapes are aligned. A workspace
        // migration removes the *package-identity* half of this gap (see shared/MIGRATION.md);
        // the *dialect* half is inherent and always needs the assertion.
        await m.run(args, {
          tx: tx as unknown as AppTx,
          schema: sqliteSchema as unknown as AppSchema,
          userId
        });
      });
    }) as Mutate<M>[typeof key];
  }

  return mutate;
};
