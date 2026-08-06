import { DrizzleAppSchema } from '@powersync/drizzle-driver';
import { lists, mutatorCalls, todos } from '@write-api/shared/schema/todos.sqlite';

export const LISTS_TABLE = 'lists';
export const TODOS_TABLE = 'todos';
export const MUTATOR_CALLS_TABLE = 'mutator_calls';

export const AppSchema = new DrizzleAppSchema({
  todos,
  lists,
  // Insert-only; queues mutator calls for upload.
  mutator_calls: { tableDefinition: mutatorCalls, options: { insertOnly: true } }
});

export type Database = (typeof AppSchema)['types'];
export type TodoRecord = Database['todos'];
export type ListRecord = Database['lists'];
