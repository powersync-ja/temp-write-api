import { z } from 'zod';
import type { PoolClient } from 'pg';

export interface ServerCtx {
  userId: string;
  pg: PoolClient;
}

export interface ServerMutator<S extends z.ZodTypeAny = z.ZodTypeAny> {
  args: S;
  run: (args: z.infer<S>, ctx: ServerCtx) => Promise<void>;
}
