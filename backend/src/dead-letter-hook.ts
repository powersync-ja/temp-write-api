import type { DeadLetterEntry } from './types.js';

/**
 * Fires after a transaction has been persisted to the dead-letter queue.
 * Fire-and-forget: errors here are logged and dropped; this never blocks
 * the upload response. Wire to Slack, an admin dashboard refresh, metrics,
 * etc.
 */
export const onDeadLetter = async (entry: DeadLetterEntry): Promise<void> => {
  console.warn('Dead-letter entry:', entry.id, entry.error_code, entry.failed_table);
};
