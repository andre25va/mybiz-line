-- Add action_type and action_meta columns to dispatcher_drafts for AI decision storage
ALTER TABLE dispatcher_drafts ADD COLUMN IF NOT EXISTS action_type text DEFAULT 'draft';
ALTER TABLE dispatcher_drafts ADD COLUMN IF NOT EXISTS action_meta jsonb;
