# PowerSync Write API Demo

![Architecture diagram](./diagram.png)

## Project Layout

```
write-api/
├── docker-compose.yaml                       # Postgres + MongoDB + PowerSync
├── config/
│   ├── powersync.yaml                        # PowerSync service config
│   └── sync_rules.yaml                       # Sync rules (lists + todos)
├── init-scripts/
│   └── setup.sql                             # DB schema + seed data
├── powersync-nodejs-backend-todolist-demo/    # Backend (Express, port 6060)
│   └── .env
└── demo-app/                                 # Frontend (React/Vite, port 5173)
    └── .env.local
```

## Running Everything

```bash
# 1. Start infrastructure (Postgres, Mongo, PowerSync)
docker compose up -d

# 2. Start backend (new terminal)
cd backend && pnpm install && pnpm start

# 3. Start frontend (new terminal)
cd frontend && pnpm install && pnpm dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:6060
- PowerSync: http://localhost:8080
- Postgres: localhost:5432

## Huge Transaction Flow

`openapi.yaml` defines a stage/commit/poll flow for transactions too
large to fit in a single `postCrudTransaction` call. The client decides
which option to use by comparing the transaction's op count against a
configured `MAX_TRANSACTION_OPS`. If too long, the transation's operations are split into chunks and staged in batches before the transaction is committed.

```mermaid
sequenceDiagram
    participant Client
    participant Server

    Client->>Client: ops.length > MAX_TRANSACTION_OPS?

    alt normal transaction
        Client->>Server: POST /api/data<br/>{ crud: [...] }
        Server-->>Client: 200 OK<br/>{ status: success | retryable_error | fatal_error }
    else huge transaction
        Client->>Client: split ops into chunks of size <= MAX_TRANSACTION_OPS

        Client->>Server: PUT /api/data/transactions/{id}
        Note right of Server: begin staging
        Server-->>Client: 201 Created (or 200 if already staging)<br/>{ staged_count }

        loop each chunk
            Client->>Server: POST /api/data/transactions/{id}/operations<br/>[CrudEntry, ...]
            Server-->>Client: 202 Accepted<br/>{ staged_count }
        end

        Client->>Server: POST /api/data/transactions/{id}/commit
        Note right of Server: idempotent, can be retried, returns instantly
        Server-->>Client: 202 Accepted<br/>{ status: pending | processing }

        par background batch job
            Server->>Server: run staged operations as a background transaction
        and client polls
            loop until terminal status
                Client->>Server: GET /api/data/transactions/{id}
                Server-->>Client: 200 OK<br/>{ status: processing | success | retryable_error | fatal_error }
            end
        end
    end
```

## Generating Types from OpenAPI Spec

Both the backend and frontend generate TypeScript types from the shared `openapi.yaml` spec.

```bash
# Backend (generates src/generated/api.ts)
cd backend && pnpm generate-types

# Frontend (generates src/generated/api.d.ts)
cd frontend && pnpm generate
```
