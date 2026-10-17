-- 000: schema snapshot of the MyBiz Line tables in production.
-- Captured 2026-10-17 from project tcappmyredeal (ref alxrmusieuzgssynktxg)
-- by reading pg_catalog. Schema only. No rows.
--
-- Andre confirmed this database is for My Biz Line. This file still snapshots
-- only the tables created for the Next.js app. contacts, tasks, messages,
-- call_notes, and reminders already exist in production, with foreign keys
-- into deals and organizations, and 009 locks those existing tables. They are
-- not recreated here. Every roa_va_* table is left untouched. Do not add one.
--
-- Production already has these objects. Do not run this file on production.
-- New environments apply this file, then 009_enable_rls_all_public.sql.
-- Historical files 002 through 008 are not an accurate recipe for this shape;
-- see supabase/README.md.
--
-- Requires the Supabase roles anon, authenticated, and service_role, and the
-- vector extension (already installed in public on production). Grants below
-- match production BEFORE 009, including the permissive otp_codes policy that
-- 009 drops. Do not expose a database that has this file applied without 009.

create extension if not exists vector with schema public;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text not null default ''::text,
  is_admin boolean default false,
  is_active boolean default true,
  invited_by uuid,
  created_at timestamptz default now(),
  admin_notes text,
  last_login timestamptz,
  ai_settings jsonb,
  constraint users_phone_key unique (phone),
  constraint users_invited_by_fkey foreign key (invited_by) references public.users (id)
);

create index if not exists users_phone_idx on public.users using btree (phone);

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists otp_codes_phone_idx on public.otp_codes using btree (phone);

create table if not exists public.biz_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  address text,
  notes text,
  business text not null default 'myredeal'::text,
  created_at timestamptz default now(),
  user_id uuid,
  status text default 'lead'::text,
  tags text[] default '{}'::text[],
  deal_tag text,
  constraint biz_contacts_user_id_fkey foreign key (user_id) references public.users (id)
);

create table if not exists public.biz_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  business text not null default 'general'::text,
  done boolean not null default false,
  due_date date,
  created_at timestamptz default now(),
  user_id uuid,
  constraint biz_tasks_user_id_fkey foreign key (user_id) references public.users (id)
);

create table if not exists public.voicemails (
  id uuid primary key default gen_random_uuid(),
  recording_sid text,
  recording_url text,
  caller_number text,
  duration_seconds integer default 0,
  transcript text default ''::text,
  ai_summary jsonb,
  heard boolean default false,
  created_at timestamptz default now(),
  user_id uuid,
  constraint voicemails_recording_sid_key unique (recording_sid),
  constraint voicemails_user_id_fkey foreign key (user_id) references public.users (id)
);

create table if not exists public.call_recordings (
  id uuid primary key default gen_random_uuid(),
  recording_sid text,
  recording_url text,
  call_sid text,
  duration_seconds integer default 0,
  transcript text default ''::text,
  ai_summary jsonb,
  created_at timestamptz default now(),
  user_id uuid,
  constraint call_recordings_recording_sid_key unique (recording_sid),
  constraint call_recordings_user_id_fkey foreign key (user_id) references public.users (id)
);

create table if not exists public.pending_vcards (
  id uuid primary key default gen_random_uuid(),
  from_number text,
  raw_vcard text,
  parsed jsonb,
  status text default 'pending'::text,
  created_at timestamptz default now(),
  user_id uuid,
  constraint pending_vcards_user_id_fkey foreign key (user_id) references public.users (id)
);

create table if not exists public.dispatcher_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  contact_phone text not null,
  contact_name text,
  status text default 'awaiting_reply'::text,
  original_command text,
  ai_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint dispatcher_sessions_user_id_fkey foreign key (user_id) references public.users (id)
);

create table if not exists public.dispatcher_drafts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  draft_text text not null,
  selected_option integer,
  status text default 'pending'::text,
  created_at timestamptz default now(),
  from_number text,
  to_number text,
  original_message text,
  action_type text default 'draft'::text,
  action_meta jsonb,
  constraint dispatcher_drafts_session_id_fkey
    foreign key (session_id) references public.dispatcher_sessions (id) on delete cascade
);

create table if not exists public.group_threads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business text not null default 'personal'::text,
  members jsonb not null default '[]'::jsonb,
  last_msg text,
  unread integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  participant_key text
);

create index if not exists group_threads_participant_key_idx
  on public.group_threads using btree (participant_key);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid,
  body text not null,
  direction text not null default 'outbound'::text,
  from_number text,
  from_name text,
  date_sent timestamptz default now(),
  constraint group_messages_group_id_fkey
    foreign key (group_id) references public.group_threads (id) on delete cascade
);

create index if not exists group_messages_group_id_idx
  on public.group_messages using btree (group_id, date_sent);

create table if not exists public.scheduled_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  contact_phone text not null,
  contact_name text,
  business text,
  appointment_time timestamptz not null,
  reminder_time timestamptz not null,
  message text,
  status text default 'pending'::text,
  created_at timestamptz default now()
);

create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  filename text not null,
  source text not null,
  char_count integer,
  created_at timestamptz default now(),
  constraint kb_documents_user_id_fkey
    foreign key (user_id) references public.users (id) on delete cascade,
  constraint kb_documents_source_check
    check (source = any (array['upload'::text, 'email'::text, 'sms'::text]))
);

create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null,
  user_id uuid not null,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz default now(),
  constraint kb_chunks_doc_id_fkey
    foreign key (doc_id) references public.kb_documents (id) on delete cascade,
  constraint kb_chunks_user_id_fkey
    foreign key (user_id) references public.users (id) on delete cascade
);

create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding vector_cosine_ops);

create or replace function public.match_kb_chunks(
  query_embedding vector,
  match_user_id uuid,
  match_count integer default 5
)
returns table(id uuid, doc_id uuid, content text, similarity double precision)
language sql
stable
as $function$
  select kc.id, kc.doc_id, kc.content, 1 - (kc.embedding <=> query_embedding) as similarity
  from kb_chunks kc
  where kc.user_id = match_user_id
  order by kc.embedding <=> query_embedding
  limit match_count;
$function$;

-- Grants as they were in production on 2026-10-17, before 009.
grant all on table
  public.users,
  public.otp_codes,
  public.biz_contacts,
  public.biz_tasks,
  public.voicemails,
  public.call_recordings,
  public.pending_vcards,
  public.dispatcher_sessions,
  public.dispatcher_drafts,
  public.group_threads,
  public.group_messages,
  public.scheduled_reminders,
  public.kb_documents,
  public.kb_chunks
to anon, authenticated, service_role;

grant execute on function public.match_kb_chunks(public.vector, uuid, integer)
  to anon, authenticated, service_role;

-- RLS flags as they were in production on 2026-10-17.
-- Off, and therefore readable by anon: users, dispatcher_sessions,
-- dispatcher_drafts, scheduled_reminders.
alter table public.otp_codes enable row level security;
alter table public.biz_contacts enable row level security;
alter table public.biz_tasks enable row level security;
alter table public.voicemails enable row level security;
alter table public.call_recordings enable row level security;
alter table public.pending_vcards enable row level security;
alter table public.group_threads enable row level security;
alter table public.group_messages enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;

-- The live hole: anon can select every OTP code. 009 drops this policy.
do $policy$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'otp_codes'
      and policyname = 'anon_select_otp_codes'
  ) then
    create policy anon_select_otp_codes
      on public.otp_codes
      for select
      to anon
      using (true);
  end if;
end
$policy$;
