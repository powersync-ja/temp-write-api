import type { components, operations } from './generated/api.ts';

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

export interface Persister {
  updateBatch: (batch: CrudEntry[]) => Promise<void>;
}
