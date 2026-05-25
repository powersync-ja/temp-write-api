import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import config from '../../config.js';
import { factories } from '../persistance/persister-factories.js';
import { FatalOperationError, RetryableError } from '../errors.js';
import { onDeadLetter } from '../dead-letter-hook.js';
import type { DeadLetterEntry, OpBody, OpResponse } from '../types.js';

const router = express.Router();

const persistenceFactory = factories[config.database.type];
if (!persistenceFactory) {
  throw new Error(`Unsupported database type: ${config.database.type}`);
}
if (!config.database.uri) {
  throw new Error('DATABASE_URI environment variable is required');
}

const persister = await persistenceFactory(config.database.uri, { onDeadLetter });

/**
 * Handle a CrudTransaction.
 */
router.post(
  '/',
  async (
    req: Request<{}, OpResponse<'postCrudTransaction'>, OpBody<'postCrudTransaction'>>,
    res: Response<OpResponse<'postCrudTransaction'>>
  ) => {
    try {
      await persister.updateBatch(req.body.crud);
      res.status(200).send({ status: 'success', message: 'Transaction completed' });
    } catch (e) {
      if (e instanceof FatalOperationError) {
        const entry: DeadLetterEntry = {
          id: randomUUID(),
          transaction_id: req.body.transaction_id ?? null,
          crud: req.body.crud,
          failed_client_id: e.failedOp.client_id,
          failed_table: e.failedOp.table,
          failed_op: e.failedOp.op,
          error_code: e.errorCode,
          error_message: e.message,
          created_at: new Date().toISOString()
        };
        await persister.writeDeadLetter(entry);
        res.status(200).send({
          status: 'dead_lettered',
          message: e.message,
          failed_operation: { error_code: e.errorCode, message: e.message }
        });
      } else if (e instanceof RetryableError) {
        res.status(200).send({
          status: 'retryable_error',
          message: e.message
        });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(200).send({ status: 'retryable_error', message: msg });
      }
    }
  }
);

export { router as dataRouter };
