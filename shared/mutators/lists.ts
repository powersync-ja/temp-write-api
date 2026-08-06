import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Mutator } from './runtime.js';

export const listCreateArgs = z.object({
  id: z.uuid(),
  name: z.string().min(1)
});

export const listCreate: Mutator<typeof listCreateArgs> = {
  args: listCreateArgs,
  run: async (args, { tx, schema, userId }) => {
    await tx.insert(schema.lists).values({
      id: args.id,
      name: args.name,
      ownerId: userId,
      createdAt: new Date().toISOString()
    });
  }
};

export const listDeleteArgs = z.object({ id: z.uuid() });

export const listDelete: Mutator<typeof listDeleteArgs> = {
  args: listDeleteArgs,
  run: async (args, { tx, schema }) => {
    await tx.delete(schema.todos).where(eq(schema.todos.listId, args.id));
    await tx.delete(schema.lists).where(eq(schema.lists.id, args.id));
  }
};
