import { z } from 'zod';
import { LISTS_TABLE, TODOS_TABLE } from '@/library/powersync/AppSchema';
import type { ClientMutator } from './runtime';

const listCreateArgs = z.object({
  id: z.string().uuid(),
  name: z.string().min(1)
});

const listCreate: ClientMutator<typeof listCreateArgs> = {
  args: listCreateArgs,
  run: async (args, tx, ctx) => {
    await tx.execute(
      `INSERT INTO ${LISTS_TABLE} (id, created_at, name, owner_id, _metadata)
       VALUES (?, datetime(), ?, ?, ?)`,
      [args.id, args.name, ctx.userId, ctx.metadata]
    );
  }
};

const listDeleteArgs = z.object({ id: z.string().uuid() });

const listDelete: ClientMutator<typeof listDeleteArgs> = {
  args: listDeleteArgs,
  run: async (args, tx, ctx) => {
    await tx.execute(`UPDATE ${TODOS_TABLE} SET _deleted = TRUE, _metadata = ? WHERE list_id = ?`, [
      ctx.metadata,
      args.id
    ]);
    await tx.execute(`UPDATE ${LISTS_TABLE} SET _deleted = TRUE, _metadata = ? WHERE id = ?`, [ctx.metadata, args.id]);
  }
};

const todoCreateArgs = z.object({
  id: z.string().uuid(),
  list_id: z.string().uuid(),
  description: z.string().min(1)
});

const todoCreate: ClientMutator<typeof todoCreateArgs> = {
  args: todoCreateArgs,
  run: async (args, tx, ctx) => {
    await tx.execute(
      `INSERT INTO ${TODOS_TABLE} (id, created_at, created_by, description, list_id, completed, _metadata)
       VALUES (?, datetime(), ?, ?, ?, 0, ?)`,
      [args.id, ctx.userId, args.description, args.list_id, ctx.metadata]
    );
  }
};

const todoToggleArgs = z.object({
  id: z.string().uuid(),
  completed: z.boolean()
});

const todoToggle: ClientMutator<typeof todoToggleArgs> = {
  args: todoToggleArgs,
  run: async (args, tx, ctx) => {
    const completedAt = args.completed ? new Date().toISOString() : null;
    const completedBy = args.completed ? ctx.userId : null;
    await tx.execute(
      `UPDATE ${TODOS_TABLE}
         SET completed = ?, completed_at = ?, completed_by = ?, _metadata = ?
       WHERE id = ?`,
      [args.completed ? 1 : 0, completedAt, completedBy, ctx.metadata, args.id]
    );
  }
};

const todoDeleteArgs = z.object({ id: z.string().uuid() });

const todoDelete: ClientMutator<typeof todoDeleteArgs> = {
  args: todoDeleteArgs,
  run: async (args, tx, ctx) => {
    await tx.execute(
      `UPDATE ${TODOS_TABLE} SET _deleted = TRUE, _metadata = ? WHERE id = ?`,
      [ctx.metadata, args.id]
    );
  }
};

export const clientMutators = {
  listCreate,
  listDelete,
  todoCreate,
  todoToggle,
  todoDelete
};
