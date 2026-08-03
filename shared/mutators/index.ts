import type { SharedMutators } from './runtime.js';
import { listCreate, listDelete } from './lists.js';
import { todoCreate, todoDelete } from './todos.js';
import { todoToggle } from './todoToggle.js';

// The single registry, keyed by mutator name — both client and backend dispatch on this.
export const sharedMutators = {
  listCreate,
  listDelete,
  todoCreate,
  todoToggle,
  todoDelete
} satisfies SharedMutators;

export type { AppSchema, AppTx, MutatorCtx, Mutator, SharedMutators } from './runtime.js';
export { listCreate, listCreateArgs, listDelete, listDeleteArgs } from './lists.js';
export { todoCreate, todoCreateArgs, todoDelete, todoDeleteArgs } from './todos.js';
export { todoToggle, todoToggleArgs } from './todoToggle.js';
