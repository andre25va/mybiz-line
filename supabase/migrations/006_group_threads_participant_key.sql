-- Add participant_key column for stable group thread identification
ALTER TABLE group_threads ADD COLUMN IF NOT EXISTS participant_key text;
CREATE INDEX IF NOT EXISTS group_threads_participant_key_idx ON group_threads(participant_key);
