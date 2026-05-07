import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import type { AbstractPowerSyncDatabase, Transaction } from '@powersync/web';

export const MUTATOR_PROTOCOL_VERSION = 1 as const;
export const MUTATOR_ENVELOPE_TYPE = 'mutator' as const;

export interface MutatorEnvelope {
  type: typeof MUTATOR_ENVELOPE_TYPE;
  v: typeof MUTATOR_PROTOCOL_VERSION;
  name: string;
  args: unknown;
  callId: string;
}

export interface ClientCtx {
  userId: string;
  /** JSON-stringified MutatorEnvelope. The mutator implementation must
   *  thread this into the `_metadata` column of every INSERT/UPDATE/DELETE
   *  it issues so PowerSync attaches it to the resulting ps_crud row. */
  metadata: string;
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
      const envelope: MutatorEnvelope = {
        type: MUTATOR_ENVELOPE_TYPE,
        v: MUTATOR_PROTOCOL_VERSION,
        name: key,
        args,
        callId: uuid()
      };
      const metadata = JSON.stringify(envelope);
      const { userId } = getUser();
      await db.writeTransaction(async (tx) => {
        await m.run(args, tx, { userId, metadata });
      });
    }) as Mutate<M>[typeof key];
  }

  return mutate;
};

export const parseMutatorEnvelope = (raw: string | null | undefined): MutatorEnvelope | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.type === MUTATOR_ENVELOPE_TYPE &&
      parsed.v === MUTATOR_PROTOCOL_VERSION &&
      typeof parsed.name === 'string' &&
      typeof parsed.callId === 'string'
    ) {
      return parsed as MutatorEnvelope;
    }
  } catch {
    /* not a mutator envelope */
  }
  return null;
};
