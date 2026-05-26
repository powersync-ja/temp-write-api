import type { components, operations } from './generated/api.js';
import type { EntryMapper } from './mapping/types.js';

export type CrudEntry = components['schemas']['CrudEntry'];
export type OpType = CrudEntry['op'];

/** Extract the JSON request body type for a given operation */
export type OpBody<Op extends keyof operations> = operations[Op] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** Extract the JSON 200 response body type for a given operation */
export type OpResponse<Op extends keyof operations> = operations[Op] extends {
  responses: { 200: { content: { 'application/json': infer R } } };
}
  ? R
  : never;

/** Extract the query parameters type for a given operation */
export type OpQuery<Op extends keyof operations> = operations[Op] extends { parameters: { query?: infer Q } }
  ? Q
  : never;

export interface DeadLetterEntry {
  id: string;
  transaction_id: number | null;
  crud: CrudEntry[];
  failed_client_id: number;
  failed_table: string;
  failed_op: 'PUT' | 'PATCH' | 'DELETE';
  error_code: string;
  error_message: string;
  created_at: string;
}

export interface Persister {
  updateBatch: (batch: CrudEntry[]) => Promise<void>;
  writeDeadLetter: (entry: DeadLetterEntry) => Promise<void>;
}

export interface PersisterConfig {
  mapper?: EntryMapper;
  onDeadLetter?: (entry: DeadLetterEntry) => void | Promise<void>;
}

export type PersisterFactory = (uri: string, config?: PersisterConfig) => Persister | Promise<Persister>;
