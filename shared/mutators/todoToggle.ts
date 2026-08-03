import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Mutator } from './runtime.js';

// Arg schema — defined ONCE, validated on both the client and the backend.
export const todoToggleArgs = z.object({
  id: z.string().uuid(),
  completed: z.boolean()
});

// A single body. On the client it runs against PowerSync SQLite; on the backend it runs
// against Postgres. Drizzle absorbs the dialect differences that today are hand-written
// twice: booleans (integer 0/1 vs native), timestamps (ISO string via mode:'string' +
// JS-computed value), and `?` vs `$n` placeholders (driver level).
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
