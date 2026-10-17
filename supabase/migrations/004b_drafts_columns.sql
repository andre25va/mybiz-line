-- Renamed from 004_drafts_columns.sql. Already reflected in production. Do not re-run.
ALTER TABLE dispatcher_drafts
  ADD COLUMN IF NOT EXISTS from_number text,
  ADD COLUMN IF NOT EXISTS to_number text,
  ADD COLUMN IF NOT EXISTS original_message text;
