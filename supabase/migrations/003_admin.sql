-- Migration 003: Admin panel support
-- Adds admin_notes and last_login to users table

alter table if exists users
  add column if not exists admin_notes text,
  add column if not exists last_login timestamptz;

-- Index for phone lookups (login + admin search)
create index if not exists users_phone_idx on users(phone);
create index if not exists users_status_idx on users(status);
