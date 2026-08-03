import { MUTATOR_CALLS_TABLE } from '@/library/powersync/AppSchema';

export interface MutatorEnvelope {
  name: string;
  args: unknown;
  callId: string;
}

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
