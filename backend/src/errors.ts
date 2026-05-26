import type { CrudEntry } from './types.js';

/** Transient failure (deadlock, timeout, connection error). Client should retry. */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Non-recoverable failure (constraint violation, schema mismatch). Client should NOT retry. */
export class FatalOperationError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly failedOp: CrudEntry
  ) {
    super(message);
  }
}
