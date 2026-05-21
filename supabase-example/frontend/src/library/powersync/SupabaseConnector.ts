import {
  AbstractPowerSyncDatabase,
  BaseObserver,
  PowerSyncBackendConnector,
  type PowerSyncCredentials
} from '@powersync/web';

import { Session, SupabaseClient, createClient } from '@supabase/supabase-js';

import type { components } from '../../generated/api';

export type SupabaseConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  powersyncUrl: string;
};

export type SupabaseConnectorListener = {
  initialized: () => void;
  sessionStarted: (session: Session) => void;
};

export class SupabaseConnector extends BaseObserver<SupabaseConnectorListener> implements PowerSyncBackendConnector {
  readonly client: SupabaseClient;
  readonly config: SupabaseConfig;

  ready: boolean;

  currentSession: Session | null;

  constructor() {
    super();
    this.config = {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      powersyncUrl: import.meta.env.VITE_POWERSYNC_URL,
      supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    };

    this.client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      auth: {
        persistSession: true
      }
    });
    this.currentSession = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) {
      return;
    }

    const sessionResponse = await this.client.auth.getSession();
    this.updateSession(sessionResponse.data.session);

    this.ready = true;
    this.iterateListeners((cb) => cb.initialized?.());
  }

  async login(username: string, password: string) {
    const {
      data: { session },
      error
    } = await this.client.auth.signInWithPassword({
      email: username,
      password: password
    });

    if (error) {
      throw error;
    }

    this.updateSession(session);
  }

  async fetchCredentials() {
    const {
      data: { session },
      error
    } = await this.client.auth.getSession();

    if (!session || error) {
      throw new Error(`Could not fetch Supabase credentials: ${error}`);
    }

    console.debug('session expires at', session.expires_at);

    return {
      endpoint: this.config.powersyncUrl,
      token: session.access_token ?? ''
    } satisfies PowerSyncCredentials;
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    type CrudTransactionBody = components['schemas']['CrudTransaction'];
    type ApiCrudEntry = components['schemas']['CrudEntry'];
    type TransactionResponse = components['schemas']['TransactionResponse'];

    const body: CrudTransactionBody = {
      crud: transaction.crud.map((op): ApiCrudEntry => ({
        client_id: op.clientId,
        id: op.id,
        op: op.op as ApiCrudEntry['op'],
        table: op.table,
        ...(op.transactionId != null && { transaction_id: op.transactionId }),
        ...(op.opData != null && { op_data: op.opData })
      })),
      ...(transaction.transactionId != null && { transaction_id: transaction.transactionId })
    };

    const { data, error } = await this.client.functions.invoke('data', { body });
    if (error) throw error;
    const result = data as TransactionResponse;

    switch (result.status) {
      case 'success':
        await transaction.complete();
        break;
      case 'fatal_error':
        console.error('Fatal error:', result.failed_operation?.error_code, result.message);
        break;
      case 'retryable_error':
        throw new Error(result.message ?? 'Retryable error');
    }
  }

  updateSession(session: Session | null) {
    this.currentSession = session;
    if (!session) {
      return;
    }
    this.iterateListeners((cb) => cb.sessionStarted?.(session));
  }
}
