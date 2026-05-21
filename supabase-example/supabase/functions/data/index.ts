import { OpenAPIBackend, type Document } from 'openapi-backend';
import openapiDefinition from './openapi.json' with { type: 'json' };
import { createPostgresPersister } from './persistance/postgres-persistance.ts';
import { FatalOperationError, RetryableError } from './errors.ts';
import type { OpBody, OpResponse } from './types.ts';

// SUPABASE_DB_URL is auto-injected by the Supabase CLI (`supabase functions serve`)
// and present in hosted Supabase Edge Functions. In production it should point at
// the Transaction Pooler (port 6543), not the direct DB.
let uri = Deno.env.get('SUPABASE_DB_URL');
if (!uri) throw new Error('SUPABASE_DB_URL is required');
// `supabase start` injects a SUPABASE_DB_URL whose host is the db container name
// (e.g. supabase_db_powersync_demo). Deno's resolver rejects names with
// underscores per RFC 1035, surfacing as `getaddrinfo ENOTFOUND` though libc
// resolves them fine. Route through the host gateway instead.
uri = uri.replace(/supabase_db_[^:/]+:\d+/, 'host.docker.internal:54322');

const { updateBatch } = createPostgresPersister(uri);

const api = new OpenAPIBackend({ definition: openapiDefinition as Document });
await api.init();

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await req.json();

  const validation = api.validateRequest({
    method: 'post',
    path: '/api/data',
    body,
    headers: Object.fromEntries(req.headers)
  });
  if (!validation.valid) {
    return Response.json({
      status: 'fatal_error',
      message: 'Invalid request body',
      failed_operation: {
        error_code: 'VALIDATION_ERROR',
        message: validation.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ')
      }
    } satisfies OpResponse<'postCrudTransaction'>);
  }

  const typed = body as OpBody<'postCrudTransaction'>;
  try {
    await updateBatch(typed.crud);
    return Response.json({
      status: 'success',
      message: 'Transaction completed'
    } satisfies OpResponse<'postCrudTransaction'>);
  } catch (e) {
    if (e instanceof FatalOperationError) {
      return Response.json({
        status: 'fatal_error',
        message: e.message,
        failed_operation: { error_code: e.errorCode, message: e.message }
      } satisfies OpResponse<'postCrudTransaction'>);
    }
    if (e instanceof RetryableError) {
      return Response.json({
        status: 'retryable_error',
        message: e.message
      } satisfies OpResponse<'postCrudTransaction'>);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({
      status: 'retryable_error',
      message: msg
    } satisfies OpResponse<'postCrudTransaction'>);
  }
});
