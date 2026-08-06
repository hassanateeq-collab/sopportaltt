-- Managers own their whole department across ALL branches.
--
-- Previously a manager was pinned to one department AND one branch. This drops
-- the single-branch restriction everywhere: a manager now sees and manages their
-- department across every branch, may publish an SOP/test to a single branch OR
-- to all branches, and may assign across branches. Department is still the wall —
-- a Housekeeping manager never sees Kitchen. Employee codes stay confined to the
-- department (staff_read is department-only, not org-wide).
--
-- Supersedes the assign/attempt/cert read policies from 0004 (keeps their
-- cross-department-test clause, drops the branch clause). Run once after 0004.
-- Safe to re-run.

-- staff: a manager sees every staff member in her department, any branch.
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (
  public.is_admin()
  or department_id = public.manager_department()
  or id = public.jwt_staff_id()
);

drop policy if exists staff_manager_toggle on public.staff;
create policy staff_manager_toggle on public.staff for update to authenticated
  using (department_id = public.manager_department())
  with check (department_id = public.manager_department());

-- sops / tests: a manager may publish/revise for her department at ANY branch
-- scope (a single branch or all branches) — she runs the whole department.
drop policy if exists sops_manager_write on public.sops;
create policy sops_manager_write on public.sops for all to authenticated
  using (department_id = public.manager_department())
  with check (department_id = public.manager_department());

drop policy if exists tests_manager_write on public.tests;
create policy tests_manager_write on public.tests for all to authenticated
  using (department_id = public.manager_department())
  with check (department_id = public.manager_department());

-- acknowledgments: read across the department's branches.
drop policy if exists ack_staff_rw on public.acknowledgments;
create policy ack_staff_rw on public.acknowledgments for select to authenticated
  using (staff_id = public.jwt_staff_id() or public.is_admin()
         or exists (select 1 from public.staff s where s.id = acknowledgments.staff_id
                    and s.department_id = public.manager_department()));

-- assignments: department-wide, plus assignments on tests the manager owns
-- (the cross-department clause carried over from 0004).
drop policy if exists assign_read on public.test_assignments;
create policy assign_read on public.test_assignments for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = test_assignments.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = test_assignments.test_id
             and t.department_id = public.manager_department())
);

drop policy if exists assign_manager_write on public.test_assignments;
create policy assign_manager_write on public.test_assignments for all to authenticated
  using (
    exists (select 1 from public.staff s where s.id = test_assignments.staff_id
            and s.department_id = public.manager_department())
    or exists (select 1 from public.tests t where t.id = test_assignments.test_id
               and t.department_id = public.manager_department())
  )
  with check (
    exists (select 1 from public.staff s where s.id = test_assignments.staff_id
            and s.department_id = public.manager_department())
    or exists (select 1 from public.tests t where t.id = test_assignments.test_id
               and t.department_id = public.manager_department())
  );

-- attempts / certifications: department-wide, plus rows on the manager's tests.
drop policy if exists attempts_read on public.attempts;
create policy attempts_read on public.attempts for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = attempts.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = attempts.test_id
             and t.department_id = public.manager_department())
);

drop policy if exists certs_read on public.certifications;
create policy certs_read on public.certifications for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = certifications.staff_id
             and s.department_id = public.manager_department())
  or exists (select 1 from public.tests t where t.id = certifications.test_id
             and t.department_id = public.manager_department())
);

drop policy if exists grants_read on public.retest_grants;
create policy grants_read on public.retest_grants for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = retest_grants.staff_id
             and s.department_id = public.manager_department())
);
