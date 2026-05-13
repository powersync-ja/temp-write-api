# PowerSync + Supabase Demo

Self-contained demo of PowerSync against a local Supabase project. Three
pieces:

```
supabase-example/
├── powersync/  # PowerSync service + Mongo (docker-compose)
├── supabase/   # Supabase project (config, migrations, Edge Function, RPC)
└── frontend/   # React/Vite todolist
```

## Quick start

```bash
# 1. Start Supabase (generates signing key on first run)
cd supabase && ./setup.sh
supabase functions serve data

# 2. Start PowerSync + Mongo
cd ../powersync && cp .env.template .env && docker compose up -d

# 3. Start the frontend
cd ../frontend && pnpm install && cp .env.template .env && pnpm dev
```

- Frontend: http://localhost:5173
- PowerSync: http://localhost:8080
- Supabase API: http://localhost:54321
- Supabase Studio: http://127.0.0.1:54323

See `powersync/README.md` for stack details (networking, JWKS, teardown).
