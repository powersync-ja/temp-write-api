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
        const { data, error } = await client.POST('/api/data', { body });
        if (error) throw new Error(`Failed to post transaction: ${error.message}`);
        return data;
      }
    }
  };
}
