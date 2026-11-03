-- Branch Manager role.
--
-- A branch manager oversees ONE branch and is read-only + comments. They:
--   * see every SOP (all departments, all statuses) and leave comments /
--     change-suggestions on them for the owning department manager;
--   * see the assessment results (attempts, certifications, assignments) of the
--     staff in their OWN branch, across every department;
--   * never edit, approve, assign, or manage anyone.
--
-- The department-manager helpers (manager_department/branch/branch_code) already
-- filter role='manager', so a branch manager inherits NONE of a department
-- manager's write access. This migration adds read-only branch-scoped grants on
-- top, and a comments table. Supersedes the read policies it re-creates; safe to
-- re-run.

-- ---------------------------------------------------------------- helpers ----

-- True when the signed-in user is an active branch manager.
create or replace function public.is_branch_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.managers m
    where m.auth_user_id = auth.uid() and m.active and m.role = 'branch_manager'
  );
$$;

-- The branch a branch manager oversees (NULL for anyone who isn't one).
create or replace function public.branch_manager_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select m.branch_id from public.managers m
  where m.auth_user_id = auth.uid() and m.active and m.role = 'branch_manager'
  limit 1;
$$;

-- ----------------------------------------------------------- read policies ----

-- sops: a branch manager sees every SOP (org-wide review), at any status.
drop policy if exists sops_read on public.sops;
create policy sops_read on public.sops for select to authenticated using (
  public.is_admin()
  or public.is_branch_manager()
  or department_id = public.manager_department()
  or (department_id = public.jwt_staff_department()
      and public.scope_includes(branch_scope, public.jwt_staff_branch_code()))
);

-- tests: a branch manager sees every test (needed to label the results they view).
drop policy if exists tests_read on public.tests;
create policy tests_read on public.tests for select to authenticated using (
  public.is_admin()
  or public.is_branch_manager()
  or department_id = public.manager_department()
  or (status = 'published' and department_id = public.jwt_staff_department()
      and public.scope_includes(branch_scope, public.jwt_staff_branch_code()))
);

-- staff: a branch manager sees the staff in their own branch (every department).
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (
  public.is_admin()
  or department_id = public.manager_department()
  or branch_id = public.branch_manager_branch()
  or id = public.jwt_staff_id()
);

-- attempts: a branch manager sees the test attempts of their own branch's staff.
drop policy if exists attempts_read on public.attempts;
create policy attempts_read on public.attempts for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = attempts.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = attempts.test_id
             and t.department_id = public.manager_department())
  or exists (select 1 from public.staff s where s.id = attempts.staff_id
             and s.branch_id = public.branch_manager_branch())
);

-- certifications: same branch scope for the branch manager.
drop policy if exists certs_read on public.certifications;
create policy certs_read on public.certifications for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = certifications.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = certifications.test_id
             and t.department_id = public.manager_department())
  or exists (select 1 from public.staff s where s.id = certifications.staff_id
             and s.branch_id = public.branch_manager_branch())
);

-- assignments: a branch manager sees which tests their own branch's staff carry.
drop policy if exists assign_read on public.test_assignments;
create policy assign_read on public.test_assignments for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = test_assignments.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = test_assignments.test_id
             and t.department_id = public.manager_department())
  or exists (select 1 from public.staff s where s.id = test_assignments.staff_id
             and s.branch_id = public.branch_manager_branch())
);

-- --------------------------------------------------------- sop comments ----

-- Change-suggestions / comments on an SOP. Branch managers raise them; the owning
-- department manager and the admin see and reply in the same thread.
create table if not exists public.sop_comments (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops(id) on delete cascade,
  -- The author's managers-table id, or NULL when an admin wrote it.
  author_manager_id uuid references public.managers(id) on delete set null,
  author_name text not null,
  author_role text not null check (author_role in ('manager', 'branch_manager', 'admin')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists sop_comments_sop_idx on public.sop_comments (sop_id, created_at);

alter table public.sop_comments enable row level security;

-- Read: admins and branch managers see every thread (they see every SOP); a
-- department manager sees threads on their own department's SOPs. Staff never.
drop policy if exists sop_comments_read on public.sop_comments;
create policy sop_comments_read on public.sop_comments for select to authenticated using (
  public.is_admin()
  or public.is_branch_manager()
  or exists (select 1 from public.sops s where s.id = sop_comments.sop_id
             and s.department_id = public.manager_department())
);

-- Writes go through the sop-comment Edge Function (service_role), which stamps
-- the author from the caller's directory row — so no INSERT policy is granted to
-- authenticated here on purpose.

grant select on public.sop_comments to authenticated;
