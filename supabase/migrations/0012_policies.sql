-- Policies, owned by HR.
--
-- A reintroduced HR role (org-wide, no department/branch) writes, publishes and
-- tracks company policies — one Drive folder per department inside a Policies
-- root. The admin and every manager (department + branch) read a published
-- policy and acknowledge it; HR sees who has signed. Staff do NOT see policies.
--
-- HR is Policies-only: the SOP/test/staff helpers already filter role='manager'
-- or role='branch_manager', so HR inherits none of them. Safe to re-run.

-- Each department's Policies Drive folder (inside the Policies root), admin/HR-set.
alter table public.departments add column if not exists policy_folder_id text;

-- ---------------------------------------------------------------- helpers ----

-- True when the signed-in user is active HR.
create or replace function public.is_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.managers m
    where m.auth_user_id = auth.uid() and m.active and m.role = 'hr'
  );
$$;

-- True when the signed-in user is any active manager (department / branch / HR).
-- Used to let every manager read published policies.
create or replace function public.is_manager_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.managers m
    where m.auth_user_id = auth.uid() and m.active
  );
$$;

-- --------------------------------------------------------------- policies ----

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  summary text,
  department_id uuid not null references public.departments(id) on delete restrict,
  -- Inline document, same shape as an SOP's sop_doc ({ body, purpose, appliesTo }).
  policy_doc jsonb,
  -- Optional uploaded file in the department's Policies Drive folder.
  document_file_id text,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_by text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.policies enable row level security;

-- Read: HR sees everything (drafts included); the admin and every manager see
-- PUBLISHED policies. Staff never.
drop policy if exists policies_read on public.policies;
create policy policies_read on public.policies for select to authenticated using (
  public.is_admin()
  or public.is_hr()
  or (status = 'published' and public.is_manager_user())
);

-- Write: HR only — create, edit, publish, delete, across every department. (The
-- admin reads and acknowledges but does not author.)
drop policy if exists policies_hr_write on public.policies;
create policy policies_hr_write on public.policies for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

grant select on public.policies to authenticated;

-- ------------------------------------------------------ acknowledgments ----

create table if not exists public.policy_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  -- The acknowledger's managers-table id, or NULL when the admin acknowledged.
  manager_id uuid references public.managers(id) on delete set null,
  name text not null,
  role text not null check (role in ('manager', 'branch_manager', 'hr', 'admin')),
  -- Pinned to the policy version so a re-publish reopens the obligation.
  version int not null,
  acknowledged_at timestamptz not null default now()
);

create index if not exists policy_ack_policy_idx on public.policy_acknowledgments (policy_id, version);

alter table public.policy_acknowledgments enable row level security;

-- Read: HR and the admin see every acknowledgment (the sign-off board); a manager
-- sees their own rows.
drop policy if exists policy_ack_read on public.policy_acknowledgments;
create policy policy_ack_read on public.policy_acknowledgments for select to authenticated using (
  public.is_admin()
  or public.is_hr()
  or exists (select 1 from public.managers m
             where m.id = policy_acknowledgments.manager_id and m.auth_user_id = auth.uid())
);

-- Acknowledgments are written through the policy-ack Edge Function (service_role),
-- which stamps the acknowledger from the caller — so no INSERT policy for
-- authenticated here on purpose.

grant select on public.policy_acknowledgments to authenticated;
