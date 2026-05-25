CREATE TABLE powersync_dead_letter (
  id CHAR(36) NOT NULL PRIMARY KEY,
  transaction_id BIGINT NULL,
  crud JSON NOT NULL,
  failed_client_id BIGINT NOT NULL,
  failed_table VARCHAR(255) NOT NULL,
  failed_op VARCHAR(16) NOT NULL,
  error_code VARCHAR(64) NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX powersync_dead_letter_created_at_idx (created_at),
  INDEX powersync_dead_letter_table_idx (failed_table)
);
