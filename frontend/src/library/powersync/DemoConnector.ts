import { v4 as uuid } from 'uuid';

import { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/web';
import { WriteAPIClient } from './WriteAPIClient';
import { createOpenAPIClient, type OpenAPIClient } from './OpenAPITransport';

export type DemoConfig = {
  backendUrl: string;
  powersyncUrl: string;
};

const USER_ID_STORAGE_KEY = 'ps_user_id';

export class DemoConnector implements PowerSyncBackendConnector {
  readonly config: DemoConfig;
  readonly userId: string;
  readonly apiClient: OpenAPIClient;

  private _clientId: string | null;
  private _writeClient: WriteAPIClient | null;

  constructor() {
    let userId = localStorage.getItem(USER_ID_STORAGE_KEY);
    if (!userId) {
      userId = uuid();
      localStorage.setItem(USER_ID_STORAGE_KEY, userId);
    }
    this.userId = userId;
    this._clientId = null;
    this._writeClient = null;

    this.config = {
      backendUrl: import.meta.env.VITE_BACKEND_URL,
      powersyncUrl: import.meta.env.VITE_POWERSYNC_URL
    };

    this.apiClient = createOpenAPIClient(this.config.backendUrl);
  }

  async fetchCredentials() {
    const tokenEndpoint = 'api/auth/token';
    const res = await fetch(`${this.config.backendUrl}/${tokenEndpoint}?user_id=${this.userId}`);

    if (!res.ok) {
      throw new Error(`Received ${res.status} from ${tokenEndpoint}: ${await res.text()}`);
    }

    const { token } = await res.json();

    return {
      endpoint: this.config.powersyncUrl,
      token
    };
  }

  private async getWriteClient(database: AbstractPowerSyncDatabase): Promise<WriteAPIClient> {
    if (!this._writeClient) {
      this._writeClient = new WriteAPIClient({
        transport: this.apiClient.transport,
        userId: this.userId,
        clientId: this._clientId!,
        useCustomCheckpoints: import.meta.env.VITE_CHECKPOINT_MODE === 'custom'
      });
    }
    return this._writeClient;
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    this._clientId = await database.getClientId();
    const writeClient = await this.getWriteClient(database);
    const result = await writeClient.processTransaction(transaction);

    switch (result.status) {
      case 'success':
        await transaction.complete(result.checkpoint);
        break;
      case 'fatal_error':
        console.error('Fatal error:', result.failedOperation?.error_code, result.message);
        break;
      case 'retryable_error':
        throw new Error(result.message ?? 'Retryable error');
    }
  }
}
