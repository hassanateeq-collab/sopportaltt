-- Three changes:
--   (A) No SOP approval chain — a department manager owns and freely edits their
--       department's SOPs, which are live on upload.
--   (B) HR can comment on (review) SOPs.
--   (C) Policies reach everyone: staff read & acknowledge them, and publishing a
--       policy notifies every staff member.
-- Safe to re-run.

-- (A) Department heads UPLOAD SOPs freely (through the upload-sop Edge Function,
--     which runs as service_role and publishes them live), but once uploaded only
--     the ADMIN can change one. So managers get NO direct write on sops: the
--     manager write policy is dropped, leaving only sops_admin_write. Supersedes
--     the policy from 0010.
drop policy if exists sops_manager_write on public.sops;

-- (B) HR joins the admin and branch managers as an SOP reviewer: they may post
--     comments (the author_role CHECK) and read every thread.
alter table public.sop_comments drop constraint if exists sop_comments_author_role_check;
alter table public.sop_comments
  add constraint sop_comments_author_role_check
  check (author_role in ('manager', 'branch_manager', 'hr', 'admin'));

drop policy if exists sop_comments_read on public.sop_comments;
create policy sop_comments_read on public.sop_comments for select to authenticated using (
  public.is_admin()
  or public.is_hr()
  or public.is_branch_manager()
  or exists (select 1 from public.sops s where s.id = sop_comments.sop_id
             and s.department_id = public.manager_department())
);

-- (C) Staff can acknowledge a policy: the acknowledgments table gains a staff
--     linkage and a 'staff' role. (manager_id stays for management acks; exactly
--     one of manager_id / staff_id is set per row.)
alter table public.policy_acknowledgments
  add column if not exists staff_id uuid references public.staff(id) on delete cascade;

alter table public.policy_acknowledgments drop constraint if exists policy_acknowledgments_role_check;
alter table public.policy_acknowledgments
  add constraint policy_acknowledgments_role_check
  check (role in ('manager', 'branch_manager', 'hr', 'admin', 'staff'));

create index if not exists policy_ack_staff_idx on public.policy_acknowledgments (staff_id);

-- (C) Publishing a policy notifies staff — allow the notification kind.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('retest_approved', 'test_assigned', 'sop_published', 'score_recorded', 'policy_published'));

-- Staff policy acks are written by the policy-sign Edge Function and read back
-- through staff-data (both service_role); management reads them through the
-- existing policy_ack_read policy (admin/HR see all, a manager their own). No new
-- authenticated policy is needed.
