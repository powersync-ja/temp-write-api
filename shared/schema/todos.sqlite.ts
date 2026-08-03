import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Client (SQLite via PowerSync) table definitions.
// Property names mirror ./todos.pg.ts exactly. Dialect-specific storage differences
// are absorbed by Drizzle column modes:
//   - `completed` is stored as INTEGER but exposed as a JS boolean (mode: 'boolean')
//   - timestamps are TEXT (ISO strings), matching the pg tables' `mode: 'string'`
export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull(),
  createdAt: text('created_at'),
  completedAt: text('completed_at'),
  completedBy: text('completed_by'),
  description: text('description').notNull(),
  createdBy: text('created_by'),
  completed: integer('completed', { mode: 'boolean' }).notNull()
});

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  createdAt: text('created_at'),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull()
});

// Insert-only table that funnels mutator invocations into PowerSync's upload queue.
export const mutatorCalls = sqliteTable('mutator_calls', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  args: text('args').notNull(),
  createdAt: text('created_at')
});
