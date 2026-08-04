-- Cross-department test assignment.
--
-- A manager builds a test from their own department's SOP, but may assign it to
-- any staff member in any department/branch (e.g. an HR/compliance test that
-- everyone must pass). Assignment itself and the staff-side reads go through
-- Edge Functions (service_role), so this migration only widens the manager's
-- READ access enough to see the results of people they assigned from other
-- departments — assignment/attempt/certificate rows for tests in the manager's
-- own department. Staff-row reads are NOT widened, so employee codes stay
-- confined to a person's own department manager.
--
-- Run once in the SQL Editor after 0003. Safe to re-run.

-- assignments: a manager also sees assignments on tests she owns (any assignee).
drop policy if exists assign_read on public.test_assignments;
create policy assign_read on public.test_assignments for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = test_assignments.staff_id
             and s.department_id = public.manager_department()
             and s.branch_id = public.manager_branch())
  or exists (select 1 from public.tests t where t.id = test_assignments.test_id
             and t.department_id = public.manager_department())
);

-- attempts: a manager also sees attempts on tests she owns (any assignee).
drop policy if exists attempts_read on public.attempts;
create policy attempts_read on public.attempts for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = attempts.staff_id
             and s.department_id = public.manager_department()
             and s.branch_id = public.manager_branch())
  or exists (select 1 from public.tests t where t.id = attempts.test_id
             and t.department_id = public.manager_department())
);

-- certifications: a manager also sees certificates on tests she owns.
drop policy if exists certs_read on public.certifications;
create policy certs_read on public.certifications for select to authenticated using (
  staff_id = public.jwt_staff_id() or public.is_admin()
  or exists (select 1 from public.staff s where s.id = certifications.staff_id
             and s.department_id = public.manager_department()
             and s.branch_id = public.manager_branch())
  or exists (select 1 from public.tests t where t.id = certifications.test_id
             and t.department_id = public.manager_department())
);
