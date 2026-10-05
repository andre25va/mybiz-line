-- supabase/migrations/004_dispatcher.sql
-- AI Dispatcher tables

create table if not exists dispatcher_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  contact_phone text not null,
  contact_name text not null default '',
  contact_business text not null default 'Personal',
  status text not null default 'awaiting_reply',
  -- status flow: awaiting_reply → awaiting_choice → awaiting_approval → done
  last_client_reply text,
  draft_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists dispatcher_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  to_phone text not null,
  draft text not null,
  status text not null default 'pending',
  -- status: pending | sent | cancelled
  created_at timestamptz default now()
);

-- RLS
alter table dispatcher_sessions enable row level security;
alter table dispatcher_drafts enable row level security;

create policy "owner only sessions" on dispatcher_sessions
  using (user_id = auth.uid());

create policy "owner only drafts" on dispatcher_drafts
  using (user_id = auth.uid());
