-- SOP approval chain + the review roles that drive it.
--
-- Roles beyond the department 'manager': branch_manager, hr, ceo. They sign in
-- like managers but only review SOPs (they get no department write access —
-- the manager_* helpers below ignore them).
alter table public.managers
  add column if not exists role text not null default 'manager'
  check (role in ('manager', 'branch_manager', 'hr', 'ceo'));

-- Approval workflow on each SOP:
--   draft -> branch_review -> admin_review -> (hr_review) -> ceo_review -> authorized
-- 'rejected' bounces it back to the author to fix and resubmit. Existing SOPs
-- default to 'authorized' (already live). Only 'authorized' SOPs reach staff
-- (enforced in the staff-data Edge Function).
alter table public.sops
  add column if not exists approval_status text not null default 'authorized'
  check (approval_status in ('draft', 'branch_review', 'admin_review', 'hr_review', 'ceo_review', 'authorized', 'rejected'));
alter table public.sops add column if not exists approval_note text;
alter table public.sops add column if not exists submitted_by text;

-- The manager_* helpers must ignore the review roles, so a Branch Manager / HR /
-- CEO never inherits a department manager's SOP/test read+write access.
create or replace function public.manager_department()
returns uuid language sql stable security definer set search_path = public as $$
  select m.department_id from public.managers m
  where m.auth_user_id = auth.uid() and m.active and m.role = 'manager';
$$;

create or replace function public.manager_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select m.branch_id from public.managers m
  where m.auth_user_id = auth.uid() and m.active and m.role = 'manager';
$$;

create or replace function public.manager_branch_code()
returns text language sql stable security definer set search_path = public as $$
  select b.code from public.managers m
  join public.branches b on b.id = m.branch_id
  where m.auth_user_id = auth.uid() and m.active and m.role = 'manager';
$$;
