import type { SharedMutators } from "./runtime.js";
import { listCreate, listDelete } from "./lists.js";
import { todoCreate, todoToggle, todoDelete } from "./todos.js";

export const sharedMutators = {
  listCreate,
  listDelete,
  todoCreate,
  todoToggle,
  todoDelete,
} satisfies SharedMutators;

export type {
  AppSchema,
  AppTx,
  MutatorCtx,
  Mutator,
  SharedMutators,
} from "./runtime.js";
export {
  listCreate,
  listCreateArgs,
  listDelete,
  listDeleteArgs,
} from "./lists.js";
export {
  todoCreate,
  todoCreateArgs,
  todoToggle,
  todoToggleArgs,
  todoDelete,
  todoDeleteArgs,
} from "./todos.js";
