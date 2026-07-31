-- Hamsun SOP Portal — staff sign-in support (Stage 3b).
--
-- Adds what the staff-facing Edge Functions need:
--   * staff_sessions   — opaque server-side session tokens for signed-in staff
--                        (staff have no Supabase Auth account);
--   * bcrypt helpers    — hash/verify employee codes in Postgres with pgcrypto,
--                        so a plaintext code never leaves the Edge Function and a
--                        hash never reaches the browser.
--
-- Run once in the SQL Editor after 0001_init.sql. Safe to re-run.

-- pgcrypto (crypt / gen_salt) is enabled by 0001, but ensure it here too. On
-- Supabase it lives in the `extensions` schema, so the functions below set their
-- search_path to find crypt()/gen_salt() there.
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────── staff sessions ──
-- One row per signed-in staff member. The Edge Function stores only the SHA-256
-- of the opaque token it handed the browser, so a leaked table row cannot be
-- replayed as a live session. Only the service_role (inside Edge Functions) may
-- touch this table.
create table if not exists public.staff_sessions (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists staff_sessions_staff_idx on public.staff_sessions (staff_id);

alter table public.staff_sessions enable row level security;
revoke all on public.staff_sessions from anon, authenticated;

-- ─────────────────────────────────────────────── employee code lookup ──
-- Store the plaintext employee code so a signed-in manager or admin can look it
-- up and re-tell it to staff (it's a hotel PIN, not a password). Reads are
-- governed by the existing staff RLS: an admin sees all, a manager sees only her
-- own department+branch, a staff member sees only their own row. anon has no
-- access to the staff table at all, and the sign-in name directory never selects
-- this column — so the code is never exposed publicly.
alter table public.staff add column if not exists employee_code text;
grant select (employee_code) on public.staff to authenticated;

-- ─────────────────────────────────────────── employee-code bcrypt helpers ──
-- SECURITY DEFINER so they run with the owner's rights and can read/write the
-- protected employee_code_hash column. EXECUTE is revoked from everyone and
-- granted back only to service_role, so only the Edge Functions can call them.

-- Insert a staff member, hashing the numeric code with bcrypt. Returns the new
-- row (the caller drops employee_code_hash before returning it to the browser).
create or replace function public.create_staff(
  p_name text, p_department uuid, p_branch uuid, p_job text, p_code text
) returns public.staff
language plpgsql security definer set search_path = public, extensions as $$
declare r public.staff;
begin
  insert into public.staff (name, department_id, branch_id, job_title, employee_code, employee_code_hash)
  values (
    p_name,
    p_department,
    p_branch,
    coalesce(nullif(btrim(p_job), ''), 'Staff'),
    p_code,
    crypt(p_code, gen_salt('bf'))
  )
  returning * into r;
  return r;
end $$;

-- Replace a staff member's employee code with a freshly hashed one (and keep the
-- plaintext so managers/admins can look it up).
create or replace function public.set_staff_code(p_staff uuid, p_code text)
returns void language sql security definer set search_path = public, extensions as $$
  update public.staff
     set employee_code = p_code,
         employee_code_hash = crypt(p_code, gen_salt('bf'))
   where id = p_staff;
$$;

-- True when the supplied code matches the stored hash of an active staff member.
create or replace function public.verify_staff_code(p_staff uuid, p_code text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select coalesce(
    (select employee_code_hash = crypt(p_code, employee_code_hash)
       from public.staff where id = p_staff and active),
    false);
$$;

revoke all on function public.create_staff(text, uuid, uuid, text, text) from public;
revoke all on function public.set_staff_code(uuid, text) from public;
revoke all on function public.verify_staff_code(uuid, text) from public;

grant execute on function public.create_staff(text, uuid, uuid, text, text) to service_role;
grant execute on function public.set_staff_code(uuid, text) to service_role;
grant execute on function public.verify_staff_code(uuid, text) to service_role;
