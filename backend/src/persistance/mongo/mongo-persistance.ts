import * as mongo from 'mongodb';
import type { Persister, CrudEntry } from '../../types.js';
import { RetryableError, FatalOperationError } from '../../errors.js';
import type { EntryMapper } from '../../mapping/types.js';
import { mongoMapper } from '../../mapping/mongo.js';

export const createMongoPersister = async (uri: string, mapper: EntryMapper = mongoMapper): Promise<Persister> => {
  console.debug('Using MongoDB Persister');

  const client = new mongo.MongoClient(uri);
  const db = client.db();
  await client.connect();

  const persister: Persister = {
    createCheckpoint: async (user_id: string, client_id: string) => {
      const doc = await db.collection('checkpoints').findOneAndUpdate(
        {
          user_id,
          client_id
        },
        {
          $inc: {
            checkpoint: 1n
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
      return doc!.checkpoint;
    },
    updateBatch: async (batch: CrudEntry[]) => {
      // TODO: Use batches & transactions.
      try {
        for (const op of batch) {
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
          throw new FatalOperationError('UNIQUE_VIOLATION', err.message);
        } else if (err.hasErrorLabel?.('TransientTransactionError')) {
          throw new RetryableError(err.message);
        }
        throw new RetryableError(err.message);
      }
    }
  };

  return persister;
};
