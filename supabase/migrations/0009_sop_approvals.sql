-- SOP approval chain.
--
-- Simple chain: a department manager writes an SOP and submits it; the admin
-- reviews it, then approves (publishes) or sends it back. Only the department
-- 'manager' role exists; the column is kept for legacy rows and any that carried
-- the old review roles are removed below.
alter table public.managers
  add column if not exists role text not null default 'manager';
-- Retire the old review roles (branch_manager / hr / ceo) — remove those
-- accounts so they can no longer sign in.
delete from public.managers where role in ('branch_manager', 'hr', 'ceo');

-- department_id / branch_id were made nullable for the old org-wide review
-- roles; keep them nullable (harmless for department managers, which always
-- have both).
alter table public.managers alter column department_id drop not null;
alter table public.managers alter column branch_id drop not null;

-- Approval workflow on each SOP:
--   draft -> admin_review -> authorized  (admin approves)
--                         -> rejected    (admin sends back)
-- Existing SOPs default to 'authorized' (already live). Only 'authorized' SOPs
-- reach staff (enforced in the staff-data Edge Function).
alter table public.sops add column if not exists approval_status text not null default 'authorized';
-- Collapse any SOP left mid-chain by the old multi-stage flow back to the admin
-- review step, then constrain to the simple set.
update public.sops set approval_status = 'admin_review'
  where approval_status in ('branch_review', 'branch_approved', 'admin_approved', 'hr_review', 'ceo_review');
alter table public.sops drop constraint if exists sops_approval_status_check;
alter table public.sops add constraint sops_approval_status_check check (
  approval_status in ('draft', 'admin_review', 'authorized', 'rejected')
);
alter table public.sops add column if not exists approval_note text;
alter table public.sops add column if not exists submitted_by text;
-- The sign-off record for the current review round: an ordered list of
-- { role, name, action, note, at } — who submitted, who approved, who
-- authorised. Reset when the SOP is (re)submitted so "approved by all" reflects
-- the round that made it live.
alter table public.sops add column if not exists approval_trail jsonb not null default '[]'::jsonb;

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
