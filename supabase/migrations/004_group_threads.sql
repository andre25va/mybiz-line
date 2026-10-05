-- Group threads table
create table if not exists group_threads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business text not null default 'personal',
  members jsonb not null default '[]',
  last_msg text,
  unread int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table group_threads enable row level security;

-- Group messages table
create table if not exists group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references group_threads(id) on delete cascade,
  body text not null,
  direction text not null default 'outbound',
  from_number text,
  from_name text,
  date_sent timestamptz default now()
);
alter table group_messages enable row level security;

-- Index for fast message lookups
create index if not exists group_messages_group_id_idx on group_messages(group_id, date_sent);
