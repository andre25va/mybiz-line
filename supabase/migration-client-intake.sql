-- SMS/MMS client intake. Run this in the Supabase SQL editor on the existing project.
-- Safe to re-run.

alter table biz_contacts add column if not exists tags text[] not null default '{}';

create table if not exists biz_intake_messages (
  message_sid text primary key,
  owner_phone text not null,
  reply_text text,
  created_at timestamptz not null default now()
);

create table if not exists biz_intake_actions (
  id uuid primary key default gen_random_uuid(),
  message_sid text,
  owner_phone text not null,
  contact_id uuid,
  action text not null check (action in ('created', 'updated', 'classified')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  awaiting_classification boolean not null default false,
  undone boolean not null default false,
  undoable boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists biz_intake_actions_owner_created
  on biz_intake_actions (owner_phone, created_at desc);

create table if not exists biz_intake_pending (
  owner_phone text primary key,
  draft jsonb not null,
  question text,
  created_at timestamptz not null default now()
);

alter table biz_intake_messages enable row level security;
alter table biz_intake_actions enable row level security;
alter table biz_intake_pending enable row level security;
