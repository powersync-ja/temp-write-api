import { z } from 'zod';
import type { ServerMutator } from './types.js';

const listCreateArgs = z.object({
  id: z.string().uuid(),
  name: z.string().min(1)
});

const listCreate: ServerMutator<typeof listCreateArgs> = {
  args: listCreateArgs,
  run: async (args, ctx) => {
    await ctx.pg.query(
      `INSERT INTO lists (id, name, owner_id) VALUES ($1, $2, $3)`,
      [args.id, args.name, ctx.userId]
    );
  }
};

const listDeleteArgs = z.object({ id: z.string().uuid() });

const listDelete: ServerMutator<typeof listDeleteArgs> = {
  args: listDeleteArgs,
  run: async (args, ctx) => {
    await ctx.pg.query(`DELETE FROM todos WHERE list_id = $1`, [args.id]);
    await ctx.pg.query(`DELETE FROM lists WHERE id = $1`, [args.id]);
  }
};

const todoCreateArgs = z.object({
  id: z.string().uuid(),
  list_id: z.string().uuid(),
  description: z.string().min(1)
});

const todoCreate: ServerMutator<typeof todoCreateArgs> = {
  args: todoCreateArgs,
  run: async (args, ctx) => {
    await ctx.pg.query(
      `INSERT INTO todos (id, list_id, created_by, description, completed) VALUES ($1, $2, $3, $4, false)`,
      [args.id, args.list_id, ctx.userId, args.description]
    );
  }
};

const todoToggleArgs = z.object({
  id: z.string().uuid(),
  completed: z.boolean()
});

const todoToggle: ServerMutator<typeof todoToggleArgs> = {
  args: todoToggleArgs,
  run: async (args, ctx) => {
    if (args.completed) {
      await ctx.pg.query(
        `UPDATE todos SET completed = true, completed_at = now(), completed_by = $2 WHERE id = $1`,
        [args.id, ctx.userId]
      );
    } else {
      await ctx.pg.query(
        `UPDATE todos SET completed = false, completed_at = NULL, completed_by = NULL WHERE id = $1`,
        [args.id]
      );
    }
  }
};

const todoDeleteArgs = z.object({ id: z.string().uuid() });

const todoDelete: ServerMutator<typeof todoDeleteArgs> = {
  args: todoDeleteArgs,
  run: async (args, ctx) => {
    await ctx.pg.query(`DELETE FROM todos WHERE id = $1`, [args.id]);
  }
};

export const serverMutators = {
  listCreate,
  listDelete,
  todoCreate,
  todoToggle,
  todoDelete
} as const satisfies Record<string, ServerMutator>;
