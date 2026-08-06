import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Mutator } from './runtime.js';

// One body for both dialects; Drizzle handles the boolean/timestamp/placeholder differences.

export const todoCreateArgs = z.object({
  id: z.uuid(),
  list_id: z.uuid(),
  description: z.string().min(1)
});

export const todoCreate: Mutator<typeof todoCreateArgs> = {
  args: todoCreateArgs,
  run: async (args, { tx, schema, userId }) => {
    await tx.insert(schema.todos).values({
      id: args.id,
      listId: args.list_id,
      createdBy: userId,
      description: args.description,
      completed: false,
      createdAt: new Date().toISOString()
    });
  }
};

export const todoToggleArgs = z.object({
  id: z.uuid(),
  completed: z.boolean()
});

export const todoToggle: Mutator<typeof todoToggleArgs> = {
  args: todoToggleArgs,
  run: async (args, { tx, schema, userId }) => {
    await tx
      .update(schema.todos)
      .set({
        completed: args.completed,
        completedAt: args.completed ? new Date().toISOString() : null,
        completedBy: args.completed ? userId : null
      })
      .where(eq(schema.todos.id, args.id));
  }
};

export const todoDeleteArgs = z.object({ id: z.uuid() });

export const todoDelete: Mutator<typeof todoDeleteArgs> = {
  args: todoDeleteArgs,
  run: async (args, { tx, schema }) => {
    await tx.delete(schema.todos).where(eq(schema.todos.id, args.id));
  }
};
