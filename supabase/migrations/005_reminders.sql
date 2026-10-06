CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  contact_phone text NOT NULL,
  contact_name text,
  business text,
  appointment_time timestamptz NOT NULL,
  reminder_time timestamptz NOT NULL,
  message text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);
