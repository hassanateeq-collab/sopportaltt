-- Hamsun SOP & Training Portal — schema, row-level security, and seed.
--
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query →
-- paste → Run). It is written to be safe to re-run: every object uses
-- create-if-not-exists or create-or-replace, and the seed uses upserts.
--
-- The design rule this schema exists to enforce:
--   * an SOP/test that spans branches is ONE row with a jsonb branch_scope,
--     never a copy per branch;
--   * managers are physically confined to their own department + branch by RLS;
--   * staff read only their own rows, via a short-lived JWT minted by the
--     staff-login Edge Function (they have no Supabase Auth account);
--   * the employee-code hash is never selectable by the browser — only the
--     service_role (inside Edge Functions) can read it.

-- ─────────────────────────────────────────────────────────── extensions ──
create extension if not exists pgcrypto;   -- gen_random_uuid(), bcrypt crypt()

-- ──────────────────────────────────────────────────────────────── tables ──

create table if not exists public.branches (
  id     uuid primary key default gen_random_uuid(),
  code   text not null unique check (code ~ '^[A-Z]{2,4}$'),
  name   text not null,
  status text not null default 'open' check (status in ('open','pre_opening'))
);

create table if not exists public.departments (
  id   uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2,4}$'),
  name text not null
);

create table if not exists public.staff (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  department_id      uuid not null references public.departments(id),
  branch_id          uuid not null references public.branches(id),
  job_title          text not null default 'Staff',
  -- bcrypt hash of the numeric employee code. NEVER exposed to the browser
  -- (see the column grants below). Only the service_role reads it.
  employee_code_hash text not null,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create index if not exists staff_dept_branch_idx on public.staff (department_id, branch_id);

-- Managers and admins are real Supabase Auth users; these rows map an auth
-- user to their role and (for managers) their one department + branch.
create table if not exists public.managers (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  name          text not null,
  email         text not null unique,
  department_id uuid not null references public.departments(id),
  branch_id     uuid not null references public.branches(id),
  active        boolean not null default true
);

create table if not exists public.admins (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name         text not null,
  email        text not null unique
);

create table if not exists public.sops (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,               -- FD-001, HK-002, …
  title            text not null,
  summary          text not null default '',
  department_id    uuid not null references public.departments(id),
  branch_scope     jsonb not null default '{"kind":"ALL"}'::jsonb,
  version          integer not null default 1,
  document_file_id text,                               -- Google Drive file id
  video_file_id    text,
  updated_at       timestamptz not null default now(),
  published_by     text not null default ''
);
create index if not exists sops_dept_idx on public.sops (department_id);

create table if not exists public.acknowledgments (
  id        uuid primary key default gen_random_uuid(),
  staff_id  uuid not null references public.staff(id) on delete cascade,
  sop_id    uuid not null references public.sops(id) on delete cascade,
  version   integer not null,
  signed_at timestamptz not null default now(),
  unique (staff_id, sop_id, version)
);

create table if not exists public.tests (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  department_id   uuid not null references public.departments(id),
  branch_scope    jsonb not null default '{"kind":"ALL"}'::jsonb,
  related_sop_id  uuid references public.sops(id) on delete set null,
  pass_mark       integer not null default 80 check (pass_mark between 1 and 100),
  validity_months integer not null default 12 check (validity_months between 1 and 120),
  languages       text[] not null default array['en'],
  status          text not null default 'draft' check (status in ('draft','published')),
  created_at      timestamptz not null default now()
);
create index if not exists tests_dept_idx on public.tests (department_id);

create table if not exists public.questions (
  id            uuid primary key default gen_random_uuid(),
  test_id       uuid not null references public.tests(id) on delete cascade,
  position      integer not null,
  text          text not null,
  options       jsonb not null,                        -- array of exactly 4 strings
  correct_index integer not null check (correct_index between 0 and 3),
  translations  jsonb not null default '{}'::jsonb,    -- { ur: {text,options}, ps: {...} }
  audio         jsonb not null default '{}'::jsonb,     -- { ur: url, ps: url } (later)
  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4)
);
create index if not exists questions_test_idx on public.questions (test_id, position);

create table if not exists public.test_assignments (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.tests(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  assigned_by text not null default '',
  assigned_at timestamptz not null default now(),
  unique (test_id, staff_id)
);

create table if not exists public.attempts (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  test_id      uuid not null references public.tests(id) on delete cascade,
  score        integer not null,
  total        integer not null,
  percentage   integer not null,
  passed       boolean not null,
  language     text not null default 'en',
  attempted_at timestamptz not null default now()
);
create index if not exists attempts_staff_test_idx on public.attempts (staff_id, test_id, attempted_at desc);

create table if not exists public.certifications (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references public.staff(id) on delete cascade,
  test_id          uuid not null references public.tests(id) on delete cascade,
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  source_attempt_id uuid references public.attempts(id) on delete set null
);
create index if not exists certs_staff_test_idx on public.certifications (staff_id, test_id, issued_at desc);

create table if not exists public.retest_grants (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references public.tests(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  granted_by      text not null default '',
  granted_by_name text not null default '',
  granted_at      timestamptz not null default now(),
  used            boolean not null default false
);
create index if not exists grants_open_idx on public.retest_grants (staff_id, test_id) where used = false;

create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references public.staff(id) on delete cascade,
  kind             text not null check (kind in ('retest_approved','test_assigned','sop_published','score_recorded')),
  text             text not null,
  read             boolean not null default false,
  created_at       timestamptz not null default now(),
  whatsapp_pending boolean not null default true
);
create index if not exists notifications_staff_idx on public.notifications (staff_id, created_at desc);

-- Server-side lockout counter for staff login. The staff-login Edge Function is
-- the only writer; counting it here (not in the browser) is what makes the
-- three-strikes lockout real.
create table if not exists public.staff_lockouts (
  staff_id     uuid primary key references public.staff(id) on delete cascade,
  failures     integer not null default 0,
  locked_until timestamptz
);

-- ─────────────────────────────────────────────────── helper functions ──

-- Is the current Supabase Auth user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.auth_user_id = auth.uid());
$$;

-- The current manager's department / branch (null if the caller is not a manager).
create or replace function public.manager_department()
returns uuid language sql stable security definer set search_path = public as $$
  select m.department_id from public.managers m where m.auth_user_id = auth.uid() and m.active;
$$;

create or replace function public.manager_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select m.branch_id from public.managers m where m.auth_user_id = auth.uid() and m.active;
$$;

create or replace function public.manager_branch_code()
returns text language sql stable security definer set search_path = public as $$
  select b.code from public.managers m
  join public.branches b on b.id = m.branch_id
  where m.auth_user_id = auth.uid() and m.active;
$$;

-- Claims carried by the short-lived JWT the staff-login Edge Function mints.
-- security definer so they can read auth.jwt() regardless of the caller's grants
-- on the auth schema (mirrors is_admin() and the manager_* helpers).
create or replace function public.jwt_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select nullif(auth.jwt() ->> 'staff_id', '')::uuid;
$$;

create or replace function public.jwt_staff_department()
returns uuid language sql stable security definer set search_path = public as $$
  select nullif(auth.jwt() ->> 'department_id', '')::uuid;
$$;

create or replace function public.jwt_staff_branch_code()
returns text language sql stable security definer set search_path = public as $$
  select auth.jwt() ->> 'branch_code';
$$;

-- Does a branch_scope apply to a given branch code?
create or replace function public.scope_includes(scope jsonb, branch_code text)
returns boolean language sql immutable as $$
  select case
    when branch_code is null then false
    when scope ->> 'kind' = 'ALL' then true
    else coalesce((scope -> 'branch_codes') ? branch_code, false)
  end;
$$;

-- ────────────────────────────────────────────────── enable RLS + grants ──

alter table public.branches         enable row level security;
alter table public.departments      enable row level security;
alter table public.staff            enable row level security;
alter table public.managers         enable row level security;
alter table public.admins           enable row level security;
alter table public.sops             enable row level security;
alter table public.acknowledgments  enable row level security;
alter table public.tests            enable row level security;
alter table public.questions        enable row level security;
alter table public.test_assignments enable row level security;
alter table public.attempts         enable row level security;
alter table public.certifications   enable row level security;
alter table public.retest_grants    enable row level security;
alter table public.notifications    enable row level security;
alter table public.staff_lockouts   enable row level security;

-- Protect the employee-code hash: authenticated callers (managers/admins/staff
-- via PostgREST) may read only the non-secret columns of staff. The hash and the
-- lockout table are reachable exclusively by the service_role inside Edge
-- Functions, which bypasses RLS and these grants.
revoke all on public.staff from anon, authenticated;
grant select (id, name, department_id, branch_id, job_title, active, created_at)
  on public.staff to authenticated;

revoke all on public.staff_lockouts from anon, authenticated;

-- ───────────────────────────────────────────────────────────── policies ──
-- Policies are dropped-if-exists then created so this file is safe to re-run.

-- branches & departments: readable by everyone (needed for the login funnel and
-- everywhere in the UI); only admins may change them.
drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches for select using (true);
drop policy if exists branches_admin_write on public.branches;
create policy branches_admin_write on public.branches for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments for select using (true);
drop policy if exists departments_admin_write on public.departments;
create policy departments_admin_write on public.departments for all
  using (public.is_admin()) with check (public.is_admin());

-- staff: admin sees all; a manager sees only her department+branch; a staff
-- member sees only their own row. No anon access at all.
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (
  public.is_admin()
  or (department_id = public.manager_department() and branch_id = public.manager_branch())
  or id = public.jwt_staff_id()
);
-- Admins manage staff; managers may flip the active flag for their own patch.
drop policy if exists staff_admin_write on public.staff;
create policy staff_admin_write on public.staff for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists staff_manager_toggle on public.staff;
create policy staff_manager_toggle on public.staff for update to authenticated
  using (department_id = public.manager_department() and branch_id = public.manager_branch())
  with check (department_id = public.manager_department() and branch_id = public.manager_branch());

-- managers / admins directory rows: a user may read their own row; admins read all.
drop policy if exists managers_read on public.managers;
create policy managers_read on public.managers for select to authenticated
  using (public.is_admin() or auth_user_id = auth.uid());
drop policy if exists managers_admin_write on public.managers;
create policy managers_admin_write on public.managers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select to authenticated
  using (public.is_admin() or auth_user_id = auth.uid());
drop policy if exists admins_admin_write on public.admins;
create policy admins_admin_write on public.admins for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sops: admin all; manager her department; staff the SOPs their department owns
-- whose scope includes their branch (the derived eligibility rule).
drop policy if exists sops_read on public.sops;
create policy sops_read on public.sops for select to authenticated using (
  public.is_admin()
  or department_id = public.manager_department()
  or (department_id = public.jwt_staff_department()
      and public.scope_includes(branch_scope, public.jwt_staff_branch_code()))
);
drop policy if exists sops_admin_write on public.sops;
create policy sops_admin_write on public.sops for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- A manager may publish/revise only within her own department, and only scoped
-- to her own single branch — never "all branches" and never another branch.
-- This is the database making "only an admin publishes group-wide" physical.
drop policy if exists sops_manager_write on public.sops;
create policy sops_manager_write on public.sops for all to authenticated
  using (department_id = public.manager_department())
  with check (
    department_id = public.manager_department()
    and branch_scope ->> 'kind' = 'LIST'
    and jsonb_array_length(branch_scope -> 'branch_codes') = 1
    and (branch_scope -> 'branch_codes') ? public.manager_branch_code()
  );

-- acknowledgments: staff may read/insert only their own; managers/admins read
-- (for the sign-off board) within scope.
drop policy if exists ack_staff_rw on public.acknowledgments;
create policy ack_staff_rw on public.acknowledgments for select to authenticated
  using (staff_id = public.jwt_staff_id() or public.is_admin()
         or exists (select 1 from public.staff s where s.id = acknowledgments.staff_id
                    and s.department_id = public.manager_department()
                    and s.branch_id = public.manager_branch()));
-- Inserts of consequence go through the sign-sop Edge Function (service_role),
-- so no INSERT policy is granted to authenticated here on purpose.

-- tests: same visibility shape as sops. Assignment (below) is what actually
-- surfaces a test to a staff member.
drop policy if exists tests_read on public.tests;
create policy tests_read on public.tests for select to authenticated using (
  public.is_admin()
  or department_id = public.manager_department()
  or (status = 'published' and department_id = public.jwt_staff_department()
      and public.scope_includes(branch_scope, public.jwt_staff_branch_code()))
);
drop policy if exists tests_admin_write on public.tests;
create policy tests_admin_write on public.tests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists tests_manager_write on public.tests;
create policy tests_manager_write on public.tests for all to authenticated
  using (department_id = public.manager_department())
  with check (
    department_id = public.manager_department()
    and branch_scope ->> 'kind' = 'LIST'
    and jsonb_array_length(branch_scope -> 'branch_codes') = 1
    and (branch_scope -> 'branch_codes') ? public.manager_branch_code()
  );

-- questions: readable by whoever can read the parent test.
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions for select to authenticated using (
  exists (select 1 from public.tests t where t.id = questions.test_id and (
    public.is_admin()
    or t.department_id = public.manager_department()
    or (t.status = 'published' and t.department_id = public.jwt_staff_department()
        and public.scope_includes(t.branch_scope, public.jwt_staff_branch_code()))
  ))
);
drop policy if exists questions_admin_write on public.questions;
create policy questions_admin_write on public.questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists questions_manager_write on public.questions;
create policy questions_manager_write on public.questions for all to authenticated
  using (exists (select 1 from public.tests t where t.id = questions.test_id
                 and t.department_id = public.manager_department()))
  with check (exists (select 1 from public.tests t where t.id = questions.test_id
                      and t.department_id = public.manager_department()));

-- assignments: staff see their own; managers/admins manage within scope.
drop policy if exists assign_read on public.test_assignments;
create policy assign_read on public.test_assignments for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = test_assignments.staff_id
             and s.department_id = public.manager_department()
             and s.branch_id = public.manager_branch())
);
drop policy if exists assign_admin_write on public.test_assignments;
create policy assign_admin_write on public.test_assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists assign_manager_write on public.test_assignments;
create policy assign_manager_write on public.test_assignments for all to authenticated
  using (exists (select 1 from public.staff s where s.id = test_assignments.staff_id
                 and s.department_id = public.manager_department()
                 and s.branch_id = public.manager_branch()))
  with check (exists (select 1 from public.staff s where s.id = test_assignments.staff_id
                      and s.department_id = public.manager_department()
                      and s.branch_id = public.manager_branch()));

-- attempts & certifications: staff read their own; managers/admins read within
-- scope (the certification board). Inserts go through the submit-attempt Edge
-- Function only.
drop policy if exists attempts_read on public.attempts;
create policy attempts_read on public.attempts for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = attempts.staff_id
             and s.department_id = public.manager_department()
             and s.branch_id = public.manager_branch())
);
drop policy if exists certs_read on public.certifications;
create policy certs_read on public.certifications for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = certifications.staff_id
             and s.department_id = public.manager_department()
             and s.branch_id = public.manager_branch())
);

-- retest grants: staff read their own; managers/admins read+create within scope.
-- The single-attempt "used" flip happens in the submit-attempt Edge Function.
drop policy if exists grants_read on public.retest_grants;
create policy grants_read on public.retest_grants for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = retest_grants.staff_id
             and s.department_id = public.manager_department()
             and s.branch_id = public.manager_branch())
);
-- grant-retest also runs as an Edge Function so it can write the notification
-- atomically; no authenticated INSERT policy is exposed here.

-- notifications: a staff member reads and marks their own read. Writes come from
-- the Edge Functions (service_role).
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (staff_id = public.jwt_staff_id());
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (staff_id = public.jwt_staff_id())
  with check (staff_id = public.jwt_staff_id());

-- ────────────────────────────────────────────────────────────────── seed ──
-- Real branches and departments. Staff, managers, SOPs and tests are created
-- through the app once the Edge Functions are live.

insert into public.branches (code, name, status) values
  ('FSL', 'Shahrah-e-Faisal', 'open'),
  ('EXT', 'Extension',        'open'),
  ('CLF', 'Clifton',          'open'),
  ('DHA', 'DHA',              'pre_opening')
on conflict (code) do nothing;

insert into public.departments (code, name) values
  ('FD', 'Front Desk'),
  ('HK', 'Housekeeping'),
  ('KT', 'Kitchen'),
  ('MT', 'Maintenance'),
  ('QC', 'Quality & Compliance')
on conflict (code) do nothing;

-- ────────────────────────────────────────────── link YOUR admin account ──
-- Map your existing Supabase Auth login to an admins row so is_admin()
-- recognises it. This auto-detects: if there is exactly one Auth user it links
-- that one (your admin), with no email to type. If there are several it refuses
-- to guess and lists them, so you can link the right one deliberately.

do $$
declare
  user_count integer;
  admin_id   uuid;
  admin_email text;
begin
  select count(*) into user_count from auth.users;

  if user_count = 1 then
    select id, email into admin_id, admin_email from auth.users limit 1;
    insert into public.admins (auth_user_id, name, email)
    values (admin_id, 'Hamsun Group Admin', admin_email)
    on conflict (email) do update set auth_user_id = excluded.auth_user_id;
    raise notice 'Linked admin: % (%).', admin_email, admin_id;

  elsif user_count = 0 then
    raise notice 'No Auth users yet. Create your admin under Authentication, then re-run this block.';

  else
    raise notice 'Found % Auth users, so not auto-linking. To link one, run:', user_count;
    raise notice '  insert into public.admins(auth_user_id,name,email) select id, ''Admin'', email from auth.users where email = ''YOUR_ADMIN_EMAIL'' on conflict (email) do update set auth_user_id = excluded.auth_user_id;';
    raise notice 'Existing Auth users: %', (select string_agg(email, ', ') from auth.users);
  end if;
end $$;
