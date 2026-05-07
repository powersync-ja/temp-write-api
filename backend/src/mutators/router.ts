import express, { type Request, type Response } from 'express';
import PG from 'pg';
import { z } from 'zod';
import { URL } from 'url';
import config from '../../config.js';
import { FatalOperationError, RetryableError } from '../errors.js';
import type { OpBody, OpResponse } from '../types.js';
import { serverMutators } from './mutators.js';
import type { ServerMutator } from './types.js';

const { Pool } = PG;

const router = express.Router();

if (config.database.type !== 'postgres') {
  router.post('/invoke', (_req, res) => {
    res.status(200).send({
      status: 'fatal_error',
      message: `Mutators are only implemented for the postgres driver (got ${config.database.type})`,
      failed_operation: {
        error_code: 'UNSUPPORTED_DRIVER',
        message: `Configured driver "${config.database.type}" does not support mutators yet.`
      }
    });
  });
} else {
  if (!config.database.uri) {
    throw new Error('DATABASE_URI environment variable is required');
  }
  const url = new URL(config.database.uri);
  const pool = new Pool({
    host: url.hostname,
    database: url.pathname.split('/')[1],
    user: url.username,
    password: url.password,
    port: parseInt(url.port)
  });
  pool.on('error', (err) => {
    console.error('Pool connection failure to postgres (mutators):', err);
  });

  router.post(
    '/invoke',
    async (
      req: Request<{}, OpResponse<'invokeMutator'>, OpBody<'invokeMutator'>>,
      res: Response<OpResponse<'invokeMutator'>>
    ) => {
      const { name, args: rawArgs, user_id } = req.body;
      const mutator = (serverMutators as Record<string, ServerMutator>)[name];

      if (!mutator) {
        res.status(200).send({
          status: 'fatal_error',
          message: `Unknown mutator "${name}"`,
          failed_operation: { error_code: 'UNKNOWN_MUTATOR', message: `No server-side handler registered for mutator "${name}".` }
        });
        return;
      }

      let parsedArgs: unknown;
      try {
        parsedArgs = mutator.args.parse(rawArgs);
      } catch (e) {
        const message = e instanceof z.ZodError ? JSON.stringify(e.issues) : String(e);
        res.status(200).send({
          status: 'fatal_error',
          message: `Invalid args for mutator "${name}"`,
          failed_operation: { error_code: 'VALIDATION_ERROR', message }
        });
        return;
      }

      // TODO: replace user_id from body with JWT-extracted id once auth lands.
      const userId = user_id;
      if (!userId) {
        res.status(200).send({
          status: 'fatal_error',
          message: 'Missing user_id',
          failed_operation: { error_code: 'VALIDATION_ERROR', message: 'user_id is required for v1 (until JWT auth lands).' }
        });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await mutator.run(parsedArgs, { userId, pg: client });
        await client.query('COMMIT');
        res.status(200).send({ status: 'success', message: `Mutator "${name}" applied` });
      } catch (e) {
        await client.query('ROLLBACK');
        if (e instanceof FatalOperationError) {
          res.status(200).send({
            status: 'fatal_error',
            message: e.message,
            failed_operation: { error_code: e.errorCode, message: e.message }
          });
          return;
        }
        if (e instanceof RetryableError) {
          res.status(200).send({ status: 'retryable_error', message: e.message });
          return;
        }
        const err = e as Error & { code?: string };
        const code = err.code ?? '';
        if (code === '23505') {
          res.status(200).send({
            status: 'fatal_error',
            message: err.message,
            failed_operation: { error_code: 'UNIQUE_VIOLATION', message: err.message }
          });
        } else if (code === '23503') {
          res.status(200).send({
            status: 'fatal_error',
            message: err.message,
            failed_operation: { error_code: 'FOREIGN_KEY_VIOLATION', message: err.message }
          });
        } else if (code.startsWith('42')) {
          res.status(200).send({
            status: 'fatal_error',
            message: err.message,
            failed_operation: { error_code: 'SCHEMA_MISMATCH', message: err.message }
          });
        } else {
          res.status(200).send({ status: 'retryable_error', message: err.message });
        }
      } finally {
        client.release();
      }
    }
  );
}

export { router as mutatorsRouter };
