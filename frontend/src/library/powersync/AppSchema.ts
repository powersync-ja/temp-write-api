import { column, Schema, Table } from '@powersync/web';

export const LISTS_TABLE = 'lists';
export const TODOS_TABLE = 'todos';
export const MUTATOR_CALLS_TABLE = 'mutator_calls';

const todos = new Table(
  {
    list_id: column.text,
    created_at: column.text,
    completed_at: column.text,
    description: column.text,
    created_by: column.text,
    completed_by: column.text,
    completed: column.integer
  },
  { indexes: { list: ['list_id'] } }
);

const lists = new Table({
  created_at: column.text,
  name: column.text,
  owner_id: column.text
});

const mutator_calls = new Table(
  {
    name: column.text,
    args: column.text,
    created_at: column.text
  },
  { insertOnly: true }
);

export const AppSchema = new Schema({
  todos,
  lists,
  mutator_calls
});

export type Database = (typeof AppSchema)['types'];
export type TodoRecord = Database['todos'];
// OR:
// export type Todo = RowType<typeof todos>;

export type ListRecord = Database['lists'];
