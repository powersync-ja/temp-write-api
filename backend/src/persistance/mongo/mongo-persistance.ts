import * as mongo from 'mongodb';
import type { Persister, PersisterConfig, CrudEntry, DeadLetterEntry } from '../../types.js';
import { RetryableError, FatalOperationError } from '../../errors.js';
import { mongoMapper } from '../../mapping/mongo.js';

const DEAD_LETTER_COLLECTION = 'powersync_dead_letter';

export const createMongoPersister = async (uri: string, config: PersisterConfig = {}): Promise<Persister> => {
  console.debug('Using MongoDB Persister');

  const mapper = config.mapper ?? mongoMapper;
  const onDeadLetter = config.onDeadLetter;

  const client = new mongo.MongoClient(uri);
  const db = client.db();
  await client.connect();

  const persister: Persister = {
    updateBatch: async (batch: CrudEntry[]) => {
      // TODO: Use batches & transactions.
      let currentOp: CrudEntry | null = null;
      try {
        for (const op of batch) {
          currentOp = op;
          const mapped = mapper(op);
          if (mapped === null) continue;

          const collection = db.collection(mapped.table);

          if (mapped.op == 'PUT') {
            const doc: Record<string, unknown> = { _id: mapped.id, ...mapped.data };
            await collection.insertOne(doc as mongo.OptionalId<mongo.Document>);
          } else if (mapped.op == 'PATCH') {
            await collection.updateOne({ _id: mapped.id as unknown as mongo.ObjectId }, { $set: mapped.data });
          } else if (mapped.op == 'DELETE') {
            await collection.deleteOne({ _id: mapped.id as unknown as mongo.ObjectId });
          }
        }
      } catch (e) {
        const err = e as Error & { code?: number; hasErrorLabel?: (label: string) => boolean };
        if (err.code === 11000) {
          throw new FatalOperationError('UNIQUE_VIOLATION', err.message, currentOp!);
        } else if (err.hasErrorLabel?.('TransientTransactionError')) {
          throw new RetryableError(err.message);
        }
        throw new RetryableError(err.message);
      }
    },

    writeDeadLetter: async (entry: DeadLetterEntry) => {
      const collection = db.collection(DEAD_LETTER_COLLECTION);
      await collection.insertOne({
        _id: entry.id as unknown as mongo.ObjectId,
        transaction_id: entry.transaction_id,
        crud: entry.crud,
        failed_client_id: entry.failed_client_id,
        failed_table: entry.failed_table,
        failed_op: entry.failed_op,
        error_code: entry.error_code,
        error_message: entry.error_message,
        created_at: new Date(entry.created_at)
      });
      if (onDeadLetter) {
        void Promise.resolve(onDeadLetter(entry)).catch((err) =>
          console.error('onDeadLetter hook failed:', err)
        );
      }
    }
  };

  return persister;
};
