-- HR gets org-wide READ access (on top of Policies).
--
-- HR now also sees, across every department and branch (read-only, never write):
--   * SOP approvals — where each SOP stands in the review chain (sops);
--   * assessments — every staff member's tests, attempts and certifications;
--   * training records — SOP sign-offs plus the above, per person.
--
-- This re-creates the read policies, adding an `or public.is_hr()` clause so HR
-- reads everything. HR still cannot WRITE any of these (no *_write policy names
-- HR). Supersedes the read policies from 0005/0011 it re-creates; safe to re-run.

-- sops: HR sees every SOP at every status (the approval chain).
drop policy if exists sops_read on public.sops;
create policy sops_read on public.sops for select to authenticated using (
  public.is_admin()
  or public.is_hr()
  or public.is_branch_manager()
  or department_id = public.manager_department()
  or (department_id = public.jwt_staff_department()
      and public.scope_includes(branch_scope, public.jwt_staff_branch_code()))
);

-- tests: HR sees every test (to label assessment results).
drop policy if exists tests_read on public.tests;
create policy tests_read on public.tests for select to authenticated using (
  public.is_admin()
  or public.is_hr()
  or public.is_branch_manager()
  or department_id = public.manager_department()
  or (status = 'published' and department_id = public.jwt_staff_department()
      and public.scope_includes(branch_scope, public.jwt_staff_branch_code()))
);

-- staff: HR sees every staff member, every branch.
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (
  public.is_admin()
  or public.is_hr()
  or department_id = public.manager_department()
  or branch_id = public.branch_manager_branch()
  or id = public.jwt_staff_id()
);

-- attempts: HR sees every test attempt.
drop policy if exists attempts_read on public.attempts;
create policy attempts_read on public.attempts for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin() or public.is_hr()
  or exists (select 1 from public.staff s where s.id = attempts.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = attempts.test_id
             and t.department_id = public.manager_department())
  or exists (select 1 from public.staff s where s.id = attempts.staff_id
             and s.branch_id = public.branch_manager_branch())
);

-- certifications: HR sees every certification.
drop policy if exists certs_read on public.certifications;
create policy certs_read on public.certifications for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin() or public.is_hr()
  or exists (select 1 from public.staff s where s.id = certifications.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = certifications.test_id
             and t.department_id = public.manager_department())
  or exists (select 1 from public.staff s where s.id = certifications.staff_id
             and s.branch_id = public.branch_manager_branch())
);

-- assignments: HR sees which tests every staff member carries.
drop policy if exists assign_read on public.test_assignments;
create policy assign_read on public.test_assignments for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin() or public.is_hr()
  or exists (select 1 from public.staff s where s.id = test_assignments.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = test_assignments.test_id
             and t.department_id = public.manager_department())
  or exists (select 1 from public.staff s where s.id = test_assignments.staff_id
             and s.branch_id = public.branch_manager_branch())
);

-- acknowledgments: HR sees SOP sign-offs (for the training record).
drop policy if exists ack_staff_rw on public.acknowledgments;
create policy ack_staff_rw on public.acknowledgments for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin() or public.is_hr()
  or exists (select 1 from public.staff s where s.id = acknowledgments.staff_id
             and s.department_id = public.manager_department())
);
