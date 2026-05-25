CREATE TABLE powersync_dead_letter (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  transaction_id BIGINT NULL,
  crud NVARCHAR(MAX) NOT NULL,
  failed_client_id BIGINT NOT NULL,
  failed_table NVARCHAR(255) NOT NULL,
  failed_op NVARCHAR(16) NOT NULL,
  error_code NVARCHAR(64) NOT NULL,
  error_message NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE INDEX powersync_dead_letter_created_at_idx
  ON powersync_dead_letter (created_at DESC);

CREATE INDEX powersync_dead_letter_table_idx
  ON powersync_dead_letter (failed_table);
