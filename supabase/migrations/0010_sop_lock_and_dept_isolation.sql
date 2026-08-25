-- Two tightenings requested after the Manager → Admin simplification.

-- 1) A department manager may only WRITE an SOP (edit its content, start a new
--    version, or delete it) while it is a DRAFT or was SENT BACK. Once it is
--    submitted for review or approved (live), it is locked to the manager — only
--    the admin can change it then. The read policy is unchanged (a manager still
--    sees their own department's SOPs at every status). Supersedes the write
--    policy from 0005; safe to re-run.
drop policy if exists sops_manager_write on public.sops;
create policy sops_manager_write on public.sops for all to authenticated
  using (
    department_id = public.manager_department()
    and approval_status in ('draft', 'rejected')
  )
  with check (department_id = public.manager_department());

-- 2) Test assignment is confined to the manager's own department. A manager may
--    only assign/unassign a test (which they build in their own department) to
--    staff who are also in that department. RLS already limited a manager to
--    their department's staff for reads; this makes the WRITE match — a manager
--    can only create/remove an assignment row when the staff member is in their
--    department. (Admins are unaffected — assign_admin_write covers them.)
drop policy if exists assign_manager_write on public.test_assignments;
create policy assign_manager_write on public.test_assignments for all to authenticated
  using (
    exists (
      select 1 from public.staff s
      where s.id = test_assignments.staff_id
        and s.department_id = public.manager_department()
    )
  )
  with check (
    exists (
      select 1 from public.staff s
      where s.id = test_assignments.staff_id
        and s.department_id = public.manager_department()
    )
    and exists (
      select 1 from public.tests t
      where t.id = test_assignments.test_id
        and t.department_id = public.manager_department()
    )
  );
