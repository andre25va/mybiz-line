-- MyBiz Line: Contacts + Tasks tables
-- Run this in your Supabase SQL Editor

create table if not exists biz_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  address text,
  notes text,
  business text not null default 'myredeal',
  created_at timestamptz default now()
);

create table if not exists biz_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  business text not null default 'general',
  done boolean not null default false,
  due_date date,
  created_at timestamptz default now()
);

-- Enable RLS (service role bypasses these)
alter table biz_contacts enable row level security;
alter table biz_tasks enable row level security;
