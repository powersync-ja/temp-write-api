import createClient from 'openapi-fetch';
import type { paths } from '../../generated/api';
import type { WriteAPITransport } from './WriteAPIClient';

export interface OpenAPIClient {
  transport: WriteAPITransport;
  fetchToken(user_id: string): Promise<{ token: string; powersync_url: string }>;
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
      async postMutator(body) {
        const { data } = await client.POST('/api/mutators/invoke', { body });
        if (!data) throw new Error('No response from /api/mutators/invoke');
        return data;
      },
      async putCheckpoint(user_id, client_id) {
        const { data, error } = await client.PUT('/api/data/checkpoint', {
          body: { user_id, client_id }
        });
        if (error) throw new Error(`Failed to get checkpoint: ${error.message}`);
        return data;
      }
    },
    async fetchToken(user_id: string) {
      const { data, response } = await client.GET('/api/auth/token', {
        params: { query: { user_id } }
      });
      if (!data) throw new Error(`Received ${response.status} from /api/auth/token`);
      return data;
    }
  };
}
