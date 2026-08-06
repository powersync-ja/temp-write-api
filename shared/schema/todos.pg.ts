import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", {
    withTimezone: true,
    mode: "string",
  }),
  completedBy: uuid("completed_by"),
  description: text("description").notNull(),
  createdBy: uuid("created_by"),
  completed: boolean("completed").notNull().default(false),
  photoId: uuid("photo_id"),
});

export const lists = pgTable("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull(),
});
