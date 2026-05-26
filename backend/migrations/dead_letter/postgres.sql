CREATE TABLE powersync_dead_letter (
  id UUID PRIMARY KEY,
  transaction_id BIGINT,
  crud JSONB NOT NULL,
  failed_client_id BIGINT NOT NULL,
  failed_table TEXT NOT NULL,
  failed_op TEXT NOT NULL,
  error_code TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX powersync_dead_letter_created_at_idx
  ON powersync_dead_letter (created_at DESC);

CREATE INDEX powersync_dead_letter_table_idx
  ON powersync_dead_letter (failed_table);
