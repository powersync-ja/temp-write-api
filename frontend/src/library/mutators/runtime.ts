import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import type { AbstractPowerSyncDatabase, Transaction } from '@powersync/web';
import { MUTATOR_CALLS_TABLE } from '@/library/powersync/AppSchema';

export interface MutatorEnvelope {
  name: string;
  args: unknown;
  callId: string;
}

export interface ClientCtx {
  userId: string;
}

export interface ClientMutator<S extends z.ZodTypeAny = z.ZodTypeAny> {
  args: S;
  run: (args: z.infer<S>, tx: Transaction, ctx: ClientCtx) => Promise<void>;
}

export type Mutate<M extends Record<string, ClientMutator>> = {
  [K in keyof M]: (args: z.infer<M[K]['args']>) => Promise<void>;
};

export const createMutators = <M extends Record<string, ClientMutator>>(
  db: AbstractPowerSyncDatabase,
  mutators: M,
  getUser: () => { userId: string }
): Mutate<M> => {
  const mutate = {} as Mutate<M>;

  for (const key of Object.keys(mutators) as Array<keyof M & string>) {
    const m = mutators[key];
    mutate[key] = (async (rawArgs: unknown) => {
      const args = m.args.parse(rawArgs);
      const callId = uuid();
      const { userId } = getUser();
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO ${MUTATOR_CALLS_TABLE} (id, name, args, created_at)
           VALUES (?, ?, ?, datetime())`,
          [callId, key, JSON.stringify(args)]
        );
        await m.run(args, tx, { userId });
      });
    }) as Mutate<M>[typeof key];
  }

  return mutate;
};

export const mutatorEnvelopeFromCrudEntry = (entry: {
  table: string;
  id: string;
  opData?: Record<string, unknown>;
}): MutatorEnvelope | null => {
  if (entry.table !== MUTATOR_CALLS_TABLE) return null;
  const name = entry.opData?.name;
  const args = entry.opData?.args;
  if (typeof name !== 'string' || typeof args !== 'string') return null;
  try {
    return { name, args: JSON.parse(args), callId: entry.id };
  } catch {
    return null;
  }
};
