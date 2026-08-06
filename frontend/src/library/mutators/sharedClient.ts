import { wrapPowerSyncWithDrizzle } from '@powersync/drizzle-driver';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { z } from 'zod';
import { type AppSchema, type AppTx, type SharedMutators } from '@write-api/shared/mutators';
import * as sqliteSchema from '@write-api/shared/schema/todos.sqlite';

type Mutate<M extends SharedMutators> = {
  [K in keyof M]: (args: z.infer<M[K]['args']>) => Promise<void>;
};

/**
 * Runs the shared mutators against the local PowerSync DB via Drizzle. Each call records
 * the mutator_calls intent row and applies the mutator body in one transaction.
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
        await tx.run(
          sql`INSERT INTO mutator_calls (id, name, args, created_at)
              VALUES (${callId}, ${key}, ${JSON.stringify(args)}, ${new Date().toISOString()})`
        );

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
