import { URL } from 'url';
import sql from 'mssql';
import type { Persister, PersisterConfig, CrudEntry, DeadLetterEntry } from '../../types.js';
import { RetryableError, FatalOperationError } from '../../errors.js';
import { defaultMapper } from '../../mapping/default.js';

function escapeIdentifier(identifier: string): string {
  return `[${identifier}]`;
}

export const createMSSQLPersister = async (uri: string, config: PersisterConfig = {}): Promise<Persister> => {
  console.debug('Using MSSQL Persister');

  const mapper = config.mapper ?? defaultMapper;
  const onDeadLetter = config.onDeadLetter;

  const url = new URL(uri);

  const pool = new sql.ConnectionPool({
    user: url.username,
    password: url.password,
    server: url.hostname,
    port: parseInt(url.port),
    database: url.pathname.split('/')[1],
    options: {
      encrypt: true,
      trustServerCertificate: true
    }
  });

  pool.on('error', (err: Error) => {
    console.error('MSSQL pool connection failure', err);
  });

  await pool.connect();

  const persister: Persister = {
    updateBatch: async (batch: CrudEntry[]) => {
      const transaction = pool.transaction();
      let currentOp: CrudEntry | null = null;
      try {
        await transaction.begin();

        for (const op of batch) {
          currentOp = op;
          const mapped = mapper(op);
          if (mapped === null) continue;

          const table = escapeIdentifier(mapped.table);

          if (mapped.op == 'PUT') {
            const with_id: Record<string, unknown> = { ...mapped.data, id: mapped.id };

            const columnNames = Object.keys(with_id);
            const columnsEscaped = columnNames.map(escapeIdentifier);
            const columns = columnsEscaped.join(', ');
            const columnParamaters = columnNames.map((c) => `@${c}`).join(', ');
            const sourceColumns = columnsEscaped.map((column) => `source.${column}`).join(', ');

            const updateClauses: string[] = [];
            for (const key of Object.keys(mapped.data)) {
              if (key == 'id') {
                continue;
              }
              updateClauses.push(`${escapeIdentifier(key)} = source.${escapeIdentifier(key)}`);
            }

            const updateClause =
              updateClauses.length > 0 ? `WHEN MATCHED THEN UPDATE SET ${updateClauses.join(', ')}` : null;
            const insertClause = `WHEN NOT MATCHED THEN INSERT (${columns}) VALUES (${sourceColumns})`;

            const statement = `
            MERGE INTO ${table} AS t
            USING (VALUES (${columnParamaters})) AS source (${columns})
              ON t.[id] = source.[id]
            ${updateClause ? updateClause : ''}
            ${insertClause};
            `;

            const request = transaction.request();
            for (const column of columnNames) {
              request.input(column, with_id[column]);
            }
            await request.query(statement);
          } else if (mapped.op == 'PATCH') {
            const with_id: Record<string, unknown> = { ...mapped.data, id: mapped.id };

            const updateClauses: string[] = [];

            for (const key of Object.keys(mapped.data)) {
              if (key == 'id') {
                continue;
              }
              updateClauses.push(`${escapeIdentifier(key)} = @${key}`);
            }

            const statement = `
              UPDATE ${table}
              SET ${updateClauses.join(', ')}
              WHERE id = @id`;

            const request = transaction.request();
            for (const column of Object.keys(with_id)) {
              request.input(column, with_id[column]);
            }

            await request.query(statement);
          } else if (mapped.op == 'DELETE') {
            const statement = `DELETE FROM ${table} WHERE id = @id`;
            const request = transaction.request();
            request.input('id', mapped.id);
            await request.query(statement);
          }
        }
        await transaction.commit();
      } catch (e) {
        await transaction.rollback();
        const err = e as Error & { number?: number };
        const num = err.number ?? 0;
        if (num === 2627 || num === 2601) {
          throw new FatalOperationError('UNIQUE_VIOLATION', err.message, currentOp!);
        } else if (num === 547) {
          throw new FatalOperationError('FOREIGN_KEY_VIOLATION', err.message, currentOp!);
        }
        throw new RetryableError(err.message);
      }
    },

    writeDeadLetter: async (entry: DeadLetterEntry) => {
      const request = pool.request();
      request.input('id', sql.UniqueIdentifier, entry.id);
      request.input('transaction_id', sql.BigInt, entry.transaction_id);
      request.input('crud', sql.NVarChar(sql.MAX), JSON.stringify(entry.crud));
      request.input('failed_client_id', sql.BigInt, entry.failed_client_id);
      request.input('failed_table', sql.NVarChar, entry.failed_table);
      request.input('failed_op', sql.NVarChar, entry.failed_op);
      request.input('error_code', sql.NVarChar, entry.error_code);
      request.input('error_message', sql.NVarChar(sql.MAX), entry.error_message);
      request.input('created_at', sql.DateTime2, entry.created_at);
      await request.query(
        `INSERT INTO powersync_dead_letter
           (id, transaction_id, crud, failed_client_id, failed_table,
            failed_op, error_code, error_message, created_at)
         VALUES (@id, @transaction_id, @crud, @failed_client_id, @failed_table,
                 @failed_op, @error_code, @error_message, @created_at)`
      );
      if (onDeadLetter) {
        void Promise.resolve(onDeadLetter(entry)).catch((err) =>
          console.error('onDeadLetter hook failed:', err)
        );
      }
    }
  };
  return persister;
};
