import type { CrudEntry as SDKCrudEntry, CrudTransaction } from '@powersync/web';
import type { MutatorEnvelope } from '../mutators/runtime';

export interface CrudTransaction_API {
  crud: CrudEntry_API[];
  transaction_id?: number;
}

export interface CrudEntry_API {
  client_id: number;
  id: string;
  op: 'PUT' | 'PATCH' | 'DELETE';
  table: string;
  transaction_id?: number;
  op_data?: Record<string, unknown>;
}

export interface MutatorInvokeRequest_API {
  name: string;
  args: Record<string, unknown>;
  call_id: string;
  transaction_id?: number;
  user_id?: string;
}

export interface TransactionResponse {
  status: 'success' | 'retryable_error' | 'fatal_error';
  retry_after_ms?: number;
  failed_operation?: { error_code: string; message?: string };
  message?: string;
}

export interface WriteAPITransport {
  postTransaction(body: CrudTransaction_API): Promise<TransactionResponse>;
  postMutator(body: MutatorInvokeRequest_API): Promise<TransactionResponse>;
}

export interface TransactionResult {
  status: 'success' | 'retryable_error' | 'fatal_error';
  message?: string;
  failedOperation?: { error_code: string; message?: string };
}

export interface WriteAPIClientOptions {
  transport: WriteAPITransport;
  userId: string;
  clientId: string;
}

export interface IWriteAPIClient {
  processTransaction(transaction: CrudTransaction): Promise<TransactionResult>;
  processMutatorInvocation(envelope: MutatorEnvelope, transactionId?: number): Promise<TransactionResult>;
  create(table: string, id: string, data: Record<string, unknown>): Promise<TransactionResult>;
  update(table: string, id: string, data: Record<string, unknown>): Promise<TransactionResult>;
  delete(table: string, id: string): Promise<TransactionResult>;
}

export class WriteAPIClient implements IWriteAPIClient {
  private nextClientId = Date.now();

  constructor(private options: WriteAPIClientOptions) {}

  async processTransaction(transaction: CrudTransaction): Promise<TransactionResult> {
    const crud: CrudEntry_API[] = transaction.crud.map((op: SDKCrudEntry) => ({
      client_id: op.clientId,
      id: op.id,
      op: op.op as 'PUT' | 'PATCH' | 'DELETE',
      table: op.table,
      ...(op.transactionId != null && { transaction_id: op.transactionId }),
      ...(op.opData != null && { op_data: op.opData }),
      ...(op.previousValues != null && { previous_values: op.previousValues }),
      ...(op.metadata != null && { metadata: op.metadata })
    }));

    const body: CrudTransaction_API = {
      crud,
      ...(transaction.transactionId != null && { transaction_id: transaction.transactionId })
    };

    const response = await this.options.transport.postTransaction(body);

    const result: TransactionResult = {
      status: response.status,
      message: response.message,
      failedOperation: response.failed_operation
    };

    return result;
  }

  async processMutatorInvocation(envelope: MutatorEnvelope, transactionId?: number): Promise<TransactionResult> {
    const response = await this.options.transport.postMutator({
      name: envelope.name,
      args: (envelope.args as Record<string, unknown>) ?? {},
      call_id: envelope.callId,
      transaction_id: transactionId,
      user_id: this.options.userId
    });

    const result: TransactionResult = {
      status: response.status,
      message: response.message,
      failedOperation: response.failed_operation
    };

    return result;
  }

  create(table: string, id: string, data: Record<string, unknown>): Promise<TransactionResult> {
    return this.sendSingle({ op: 'PUT', table, id, op_data: data });
  }

  update(table: string, id: string, data: Record<string, unknown>): Promise<TransactionResult> {
    return this.sendSingle({ op: 'PATCH', table, id, op_data: data });
  }

  delete(table: string, id: string): Promise<TransactionResult> {
    return this.sendSingle({ op: 'DELETE', table, id });
  }

  private async sendSingle(entry: Pick<CrudEntry_API, 'op' | 'table' | 'id' | 'op_data'>): Promise<TransactionResult> {
    const body: CrudTransaction_API = {
      crud: [{ client_id: this.nextClientId++, ...entry }]
    };

    const response = await this.options.transport.postTransaction(body);

    return {
      status: response.status,
      message: response.message,
      failedOperation: response.failed_operation
    };
  }
}
