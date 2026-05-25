import mysql from 'mysql2/promise';
import type { Persister, PersisterConfig, CrudEntry, DeadLetterEntry } from '../../types.js';
import { RetryableError, FatalOperationError } from '../../errors.js';
import { defaultMapper } from '../../mapping/default.js';

function escapeIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``').replace(/\./g, '`.`')}\``;
}

export const createMySQLPersister = (uri: string, config: PersisterConfig = {}): Persister => {
  console.debug('Using MySQL Persister');

  const mapper = config.mapper ?? defaultMapper;
  const onDeadLetter = config.onDeadLetter;

  const pool = mysql.createPool(uri);

  const persister: Persister = {
    updateBatch: async (batch: CrudEntry[]) => {
      const connection = await pool.getConnection();
      let currentOp: CrudEntry | null = null;
      try {
        await connection.beginTransaction();

        for (const op of batch) {
          currentOp = op;
          const mapped = mapper(op);
          if (mapped === null) continue;

          const table = escapeIdentifier(mapped.table);

          if (mapped.op === 'PUT') {
            const with_id = { ...mapped.data, id: mapped.id };

            const columnsEscaped = Object.keys(with_id).map(escapeIdentifier);
            const columnsJoined = columnsEscaped.join(', ');

            const updateClauses: string[] = [];

            for (const key of Object.keys(mapped.data)) {
              if (key === 'id') continue;
              updateClauses.push(`${escapeIdentifier(key)} = VALUES(${escapeIdentifier(key)})`);
            }

            const updateClause = updateClauses.length > 0 ? `ON DUPLICATE KEY UPDATE ${updateClauses.join(', ')}` : ``;

            const statement = `
              INSERT INTO ${table} (${columnsJoined})
              VALUES (${Object.keys(with_id)
                .map(() => '?')
                .join(', ')})
              ${updateClause}`;

            await connection.execute(statement, Object.values(with_id));
          } else if (mapped.op === 'PATCH') {
            const updateClauses: string[] = [];

            for (const key of Object.keys(mapped.data)) {
              if (key === 'id') continue;
              updateClauses.push(`${escapeIdentifier(key)} = ?`);
            }

            const statement = `
              UPDATE ${table}
              SET ${updateClauses.join(', ')}
              WHERE id = ?`;

            const values = [...Object.values(mapped.data), mapped.id];
            await connection.execute(statement, values);
          } else if (mapped.op === 'DELETE') {
            const statement = `DELETE FROM ${table} WHERE id = ?`;
            await connection.execute(statement, [mapped.id]);
          }
        }
        await connection.commit();
      } catch (e) {
        await connection.rollback();
        const err = e as Error & { errno?: number };
        const errno = err.errno ?? 0;
        if (errno === 1062) {
          throw new FatalOperationError('UNIQUE_VIOLATION', err.message, currentOp!);
        } else if (errno === 1452) {
          throw new FatalOperationError('FOREIGN_KEY_VIOLATION', err.message, currentOp!);
        }
        throw new RetryableError(err.message);
      } finally {
        connection.release();
      }
    },

    writeDeadLetter: async (entry: DeadLetterEntry) => {
      const connection = await pool.getConnection();
      try {
        await connection.execute(
          `INSERT INTO powersync_dead_letter
             (id, transaction_id, crud, failed_client_id, failed_table,
              failed_op, error_code, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            entry.transaction_id,
            JSON.stringify(entry.crud),
            entry.failed_client_id,
            entry.failed_table,
            entry.failed_op,
            entry.error_code,
            entry.error_message,
            entry.created_at
          ]
        );
      } finally {
        connection.release();
      }
      if (onDeadLetter) {
        void Promise.resolve(onDeadLetter(entry)).catch((err) =>
          console.error('onDeadLetter hook failed:', err)
        );
      }
    }
  };
  return persister;
};
