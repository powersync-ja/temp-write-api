import createClient from 'openapi-fetch';
import type { paths } from '../../generated/api';
import type { WriteAPITransport } from './WriteAPIClient';

export interface OpenAPIClient {
  transport: WriteAPITransport;
}

export function createOpenAPIClient(baseUrl: string): OpenAPIClient {
  const client = createClient<paths>({ baseUrl });

  return {
    transport: {
      async postTransaction(body) {
        const { data } = await client.POST('/api/data', { body });
        if (!data) throw new Error('No response from /api/data');
        return data;
      },
      async putCheckpoint(user_id, client_id) {
        const { data, error } = await client.PUT('/api/data/checkpoint', {
          body: { user_id, client_id }
        });
        if (error) throw new Error(`Failed to get checkpoint: ${error.message}`);
        return data;
      }
    }
  };
}
