import { URL } from 'url';
import PG from 'pg';
import type { Persister, PersisterConfig, CrudEntry, DeadLetterEntry } from '../../types.js';
import { RetryableError, FatalOperationError } from '../../errors.js';
import { defaultMapper } from '../../mapping/default.js';

const { Pool } = PG;

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""').replace(/\./g, '"."')}"`;
}

export const createPostgresPersister = (uri: string, config: PersisterConfig = {}): Persister => {
  console.debug('Using Postgres Persister');

  const mapper = config.mapper ?? defaultMapper;
  const onDeadLetter = config.onDeadLetter;

  const url = new URL(uri);

  const pool = new Pool({
    host: url.hostname,
    database: url.pathname.split('/')[1],
    user: url.username,
    password: url.password,
    port: parseInt(url.port)
  });

  pool.on('error', (err, client) => {
    console.error('Pool connection failure to postgres:', err, client);
  });

  const persister: Persister = {
    updateBatch: async (batch: CrudEntry[]) => {
      const client = await pool.connect();
      let currentOp: CrudEntry | null = null;
      try {
        await client.query('BEGIN');

        for (const op of batch) {
          currentOp = op;
          const mapped = mapper(op);
          if (mapped === null) continue;

          const table = escapeIdentifier(mapped.table);

          if (mapped.op == 'PUT') {
            const with_id = { ...mapped.data, id: mapped.id };

            const columnsEscaped = Object.keys(with_id).map(escapeIdentifier);
            const columnsJoined = columnsEscaped.join(', ');

            const updateClauses: string[] = [];

            for (const key of Object.keys(mapped.data)) {
              if (key == 'id') {
                continue;
              }
              updateClauses.push(`${escapeIdentifier(key)} = EXCLUDED.${escapeIdentifier(key)}`);
            }

            const updateClause = updateClauses.length > 0 ? `DO UPDATE SET ${updateClauses.join(', ')}` : `DO NOTHING`;

            const statement = `
                WITH data_row AS (
                    SELECT (json_populate_record(null::${table}, $1::json)).*
                )
                INSERT INTO ${table} (${columnsJoined})
                SELECT ${columnsJoined} FROM data_row
                ON CONFLICT(id) ${updateClause}`;

            await client.query(statement, [JSON.stringify(with_id)]);
          } else if (mapped.op == 'PATCH') {
            const with_id = { ...mapped.data, id: mapped.id };

            const updateClauses: string[] = [];

            for (const key of Object.keys(mapped.data)) {
              if (key == 'id') {
                continue;
              }
              updateClauses.push(`${escapeIdentifier(key)} = data_row.${escapeIdentifier(key)}`);
            }

            const statement = `
                WITH data_row AS (
                    SELECT (json_populate_record(null::${table}, $1::json)).*
                )
                UPDATE ${table}
                SET ${updateClauses.join(', ')}
                FROM data_row
                WHERE ${table}.id = data_row.id`;
            await client.query(statement, [JSON.stringify(with_id)]);
          } else if (mapped.op == 'DELETE') {
            const statement = `
                WITH data_row AS (
                  SELECT (json_populate_record(null::${table}, $1::json)).*
                )
                DELETE FROM ${table}
                USING data_row
                WHERE ${table}.id = data_row.id`;
            await client.query(statement, [JSON.stringify({ id: mapped.id })]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        const err = e as Error & { code?: string };
        const code = err.code ?? '';
        if (code === '23505') {
          throw new FatalOperationError('UNIQUE_VIOLATION', err.message, currentOp!);
        } else if (code === '23503') {
          throw new FatalOperationError('FOREIGN_KEY_VIOLATION', err.message, currentOp!);
        } else if (code.startsWith('42')) {
          throw new FatalOperationError('SCHEMA_MISMATCH', err.message, currentOp!);
        }
        throw new RetryableError(err.message);
      } finally {
        client.release();
      }
    },

    writeDeadLetter: async (entry: DeadLetterEntry) => {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO powersync_dead_letter
             (id, transaction_id, crud, failed_client_id, failed_table,
              failed_op, error_code, error_message, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
        client.release();
      }
      if (onDeadLetter) {
        await Promise.resolve(onDeadLetter(entry)).catch((err) => console.error('onDeadLetter hook failed:', err));
      }
    }
  };
  return persister;
};
