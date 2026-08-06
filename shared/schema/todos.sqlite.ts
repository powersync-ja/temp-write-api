import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const todos = sqliteTable(
  "todos",
  {
    id: text("id").primaryKey(),
    listId: text("list_id").notNull(),
    createdAt: text("created_at"),
    completedAt: text("completed_at"),
    completedBy: text("completed_by"),
    description: text("description").notNull(),
    createdBy: text("created_by"),
    completed: integer("completed", { mode: "boolean" }).notNull(),
  },
  (t) => [index("list").on(t.listId)],
);

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  createdAt: text("created_at"),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull(),
});

export const mutatorCalls = sqliteTable("mutator_calls", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  args: text("args").notNull(),
  createdAt: text("created_at"),
});
