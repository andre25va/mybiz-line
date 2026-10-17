-- 012: OTP send limits, verify attempt cap, and hashed login codes.
-- Run once in the SQL editor after a backup. Do not run it from the app.
-- It does not alter any table whose name starts with another app's prefix.
--
-- New login codes are stored as code_hash only. The plaintext code column
-- stays for now and is nullable; a later migration can drop it. Codes issued
-- before this migration stop working, so the user requests a fresh code.
--
-- otp_try_send and otp_verify are security definer so the check and the
-- write commit together. Execute is granted only to service_role.
-- search_path is pinned. Locks are taken in hash order so two calls cannot
-- deadlock on the phone lock and the IP lock.

create table if not exists public.auth_settings (
  key text primary key,
  value integer not null,
  updated_at timestamptz not null default now()
);

insert into public.auth_settings(key, value) values
  ('otp_send_per_phone_max', 3),
  ('otp_send_per_phone_window_sec', 600),
  ('otp_send_per_ip_max', 10),
  ('otp_send_per_ip_window_sec', 600),
  ('otp_verify_max_attempts', 5),
  ('otp_ttl_sec', 600)
on conflict (key) do nothing;

create table if not exists public.otp_send_log (
  id bigserial primary key,
  phone text not null,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists otp_send_log_phone_ts on public.otp_send_log(phone, created_at desc);
create index if not exists otp_send_log_ip_ts on public.otp_send_log(ip, created_at desc);

alter table public.otp_codes add column if not exists attempts int not null default 0;
alter table public.otp_codes add column if not exists code_hash text;
alter table public.otp_codes add column if not exists created_at timestamptz default now();
alter table public.otp_codes alter column code drop not null;

create index if not exists otp_codes_phone_active on public.otp_codes(phone) where used = false;

alter table public.auth_settings enable row level security;
alter table public.otp_send_log enable row level security;

revoke all on table public.auth_settings from anon, authenticated, public;
revoke all on table public.otp_send_log from anon, authenticated, public;
revoke all on sequence public.otp_send_log_id_seq from anon, authenticated, public;

grant select, insert, update, delete on table public.auth_settings to service_role;
grant select, insert, delete on table public.otp_send_log to service_role;
grant usage, select on sequence public.otp_send_log_id_seq to service_role;

create or replace function public.otp_try_send(p_phone text, p_ip text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pmax int;
  pwin int;
  imax int;
  iwin int;
  pc int;
  ic int;
  phone_key int;
  ip_key int;
begin
  if p_phone is null or p_ip is null or length(p_phone) > 32 or length(p_ip) > 80 then
    return 'ip_limited';
  end if;

  select value into pmax from auth_settings where key = 'otp_send_per_phone_max';
  select value into pwin from auth_settings where key = 'otp_send_per_phone_window_sec';
  select value into imax from auth_settings where key = 'otp_send_per_ip_max';
  select value into iwin from auth_settings where key = 'otp_send_per_ip_window_sec';
  if pmax is null or pmax < 1 then pmax := 3; end if;
  if pwin is null or pwin < 1 then pwin := 600; end if;
  if imax is null or imax < 1 then imax := 10; end if;
  if iwin is null or iwin < 1 then iwin := 600; end if;

  phone_key := hashtext(p_phone);
  ip_key := hashtext('ip:' || p_ip);
  if phone_key <= ip_key then
    perform pg_advisory_xact_lock(phone_key::bigint);
    if ip_key <> phone_key then
      perform pg_advisory_xact_lock(ip_key::bigint);
    end if;
  else
    perform pg_advisory_xact_lock(ip_key::bigint);
    perform pg_advisory_xact_lock(phone_key::bigint);
  end if;

  select count(*) into pc
    from otp_send_log
    where phone = p_phone
      and created_at > now() - make_interval(secs => pwin);
  if pc >= pmax then
    return 'phone_limited';
  end if;

  select count(*) into ic
    from otp_send_log
    where ip = p_ip
      and created_at > now() - make_interval(secs => iwin);
  if ic >= imax then
    return 'ip_limited';
  end if;

  insert into otp_send_log(phone, ip) values (p_phone, p_ip);
  return 'ok';
end $$;

revoke all on function public.otp_try_send(text, text) from public, anon, authenticated;
grant execute on function public.otp_try_send(text, text) to service_role;

create or replace function public.otp_verify(p_phone text, p_code_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  maxa int;
  r otp_codes%rowtype;
begin
  if p_phone is null or p_code_hash is null then
    return 'invalid';
  end if;

  select value into maxa from auth_settings where key = 'otp_verify_max_attempts';
  if maxa is null or maxa < 1 then maxa := 5; end if;

  select * into r
    from otp_codes
    where phone = p_phone
      and used = false
      and expires_at > now()
    order by created_at desc
    limit 1
    for update;

  if not found then
    select * into r
      from otp_codes
      where phone = p_phone
        and used = true
        and expires_at > now()
        and attempts >= maxa
      order by created_at desc
      limit 1;
    if found then
      return 'locked';
    end if;
    return 'invalid';
  end if;

  if r.attempts >= maxa then
    update otp_codes set used = true where id = r.id;
    return 'locked';
  end if;

  update otp_codes set attempts = attempts + 1 where id = r.id;

  if r.code_hash is not null and r.code_hash = p_code_hash then
    -- A successful guess must not look burned. attempts >= max means the
    -- code was locked by wrong guesses, so a later call can return locked.
    update otp_codes
       set used = true,
           attempts = least(attempts, maxa - 1)
     where id = r.id;
    return 'ok';
  end if;

  if r.attempts + 1 >= maxa then
    update otp_codes set used = true where id = r.id;
    return 'locked';
  end if;

  return 'invalid';
end $$;

revoke all on function public.otp_verify(text, text) from public, anon, authenticated;
grant execute on function public.otp_verify(text, text) to service_role;

notify pgrst, 'reload schema';
