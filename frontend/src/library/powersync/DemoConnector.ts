import { v4 as uuid } from 'uuid';

import { AbstractPowerSyncDatabase, PowerSyncBackendConnector, type CrudTransaction } from '@powersync/web';
import { WriteAPIClient, type TransactionResult } from './WriteAPIClient';
import { createOpenAPIClient, type OpenAPIClient } from './OpenAPITransport';
import { mutatorEnvelopeFromCrudEntry } from '../mutators/runtime';
import { MUTATOR_CALLS_TABLE } from './AppSchema';

export type DemoConfig = {
  backendUrl: string;
  powersyncUrl: string;
};

const USER_ID_STORAGE_KEY = 'ps_user_id';

const fatalResult = (errorCode: string, message: string): TransactionResult => ({
  status: 'fatal_error',
  message,
  failedOperation: { error_code: errorCode, message }
});

export class DemoConnector implements PowerSyncBackendConnector {
  readonly config: DemoConfig;
  readonly userId: string;
  readonly apiClient: OpenAPIClient;

  private _clientId: string | null;
  private _writeClient: WriteAPIClient | null;
  private _writeToken: string | null;

  constructor() {
    let userId = localStorage.getItem(USER_ID_STORAGE_KEY);
    if (!userId) {
      userId = uuid();
      localStorage.setItem(USER_ID_STORAGE_KEY, userId);
    }
    this.userId = userId;
    this._clientId = null;
    this._writeClient = null;
    this._writeToken = null;

    this.config = {
      backendUrl: import.meta.env.VITE_BACKEND_URL,
      powersyncUrl: import.meta.env.VITE_POWERSYNC_URL
    };

    this.apiClient = createOpenAPIClient(this.config.backendUrl, {
      getToken: () => this.getWriteToken(),
      // Token rejected, drop it so the next write fetches a fresh one.
      onUnauthorized: () => {
        this._writeToken = null;
      }
    });
  }

  async fetchCredentials() {
    const tokenEndpoint = 'api/auth/token';
    const res = await fetch(`${this.config.backendUrl}/${tokenEndpoint}?user_id=${this.userId}`);

    if (!res.ok) {
      throw new Error(`Received ${res.status} from ${tokenEndpoint}: ${await res.text()}`);
    }

    const { token } = await res.json();

    // The write API accepts the same token PowerSync sync uses, cache it so
    // writes reuse it instead of minting their own.
    this._writeToken = token;

    return {
      endpoint: this.config.powersyncUrl,
      token
    };
  }

  private async getWriteToken(): Promise<string> {
    if (!this._writeToken) {
      await this.fetchCredentials();
    }
    return this._writeToken!;
  }

  private async getWriteClient(database: AbstractPowerSyncDatabase): Promise<WriteAPIClient> {
    if (!this._writeClient) {
      this._writeClient = new WriteAPIClient({
        transport: this.apiClient.transport,
        userId: this.userId,
        clientId: this._clientId!
      });
    }
    return this._writeClient;
  }

  /**
   * Route a CRUD transaction to the endpoint that matches its shape.
   */
  private async uploadTransaction(
    writeClient: WriteAPIClient,
    transaction: CrudTransaction
  ): Promise<TransactionResult> {
    const mutatorEntries = transaction.crud.filter((e) => e.table === MUTATOR_CALLS_TABLE);

    // No envelope: a write made against the tables directly, outside any mutator.
    if (mutatorEntries.length === 0) {
      console.warn(
        'Uploading non-mutator transaction as raw CRUD',
        transaction.crud.map((e) => e.table)
      );
      return writeClient.processTransaction(transaction);
    }

    if (mutatorEntries.length > 1) {
      return fatalResult(
        'MULTIPLE_MUTATOR_CALLS',
        `Expected one mutator call per transaction, found ${mutatorEntries.length}`
      );
    }

    const envelope = mutatorEnvelopeFromCrudEntry(mutatorEntries[0]);
    if (!envelope) {
      return fatalResult(
        'MALFORMED_MUTATOR_CALL',
        `Could not read a mutator envelope from ${MUTATOR_CALLS_TABLE} entry ${mutatorEntries[0].id}`
      );
    }

    return writeClient.processMutatorInvocation(envelope, transaction.transactionId ?? undefined);
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    this._clientId = await database.getClientId();
    const writeClient = await this.getWriteClient(database);

    const result = await this.uploadTransaction(writeClient, transaction);

    switch (result.status) {
      case 'success':
        await transaction.complete();
        break;
      case 'fatal_error':
        /**
         * Instead of blocking the queue with these errors,
         * discard the (rest of the) transaction.
         *
         * Note that these errors typically indicate a bug in the application.
         * If protecting against data loss is important, save the failing records
         * elsewhere instead of discarding, and/or notify the user.
         */
        console.error('Fatal error:', result.failedOperation?.error_code, result.message);
        await transaction.complete();
        break;
      case 'retryable_error':
        // Error is retryable - e.g. network error or temporary server error.
        // Throwing an error here causes this call to be retried after a delay.
        throw new Error(result.message ?? 'Retryable error');
    }
  }
}
