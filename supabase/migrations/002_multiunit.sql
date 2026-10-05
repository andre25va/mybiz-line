-- ============================================================
-- MyBiz Line — Multi-Unit Migration
-- Run after existing sql_migration.sql (biz_contacts etc.)
-- ============================================================

-- 1. Users table
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text not null default '',
  is_admin boolean default false,
  is_active boolean default true,
  invited_by uuid references users(id),
  created_at timestamptz default now()
);

-- 2. Seed Andre as User 1 (admin)
insert into users (id, phone, name, is_admin, is_active)
values ('00000000-0000-4000-8000-000312998898', '+13129989898', 'Andre', true, true)
on conflict (phone) do nothing;

-- 3. OTP codes table
create table if not exists otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean default false,
  created_at timestamptz default now()
);
create index if not exists otp_codes_phone_idx on otp_codes(phone);

-- 4. Add user_id to biz_contacts
alter table biz_contacts add column if not exists user_id uuid references users(id);
update biz_contacts
  set user_id = '00000000-0000-4000-8000-000312998898'
  where user_id is null;

-- 5. Add user_id to biz_tasks
alter table biz_tasks add column if not exists user_id uuid references users(id);
update biz_tasks
  set user_id = '00000000-0000-4000-8000-000312998898'
  where user_id is null;

-- 6. Add user_id to voicemails (if table exists)
alter table voicemails add column if not exists user_id uuid references users(id);
update voicemails
  set user_id = '00000000-0000-4000-8000-000312998898'
  where user_id is null;

-- 7. Add user_id to call_recordings (if table exists)
alter table call_recordings add column if not exists user_id uuid references users(id);
update call_recordings
  set user_id = '00000000-0000-4000-8000-000312998898'
  where user_id is null;

-- 8. Add user_id to pending_vcards (if table exists)
alter table pending_vcards add column if not exists user_id uuid references users(id);
update pending_vcards
  set user_id = '00000000-0000-4000-8000-000312998898'
  where user_id is null;
