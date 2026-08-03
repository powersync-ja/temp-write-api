import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Mutator } from './runtime.js';

export const todoCreateArgs = z.object({
  id: z.string().uuid(),
  list_id: z.string().uuid(),
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

export const todoDeleteArgs = z.object({ id: z.string().uuid() });

export const todoDelete: Mutator<typeof todoDeleteArgs> = {
  args: todoDeleteArgs,
  run: async (args, { tx, schema }) => {
    await tx.delete(schema.todos).where(eq(schema.todos.id, args.id));
  }
};
