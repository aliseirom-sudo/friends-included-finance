create extension if not exists pgcrypto;

create type public.employee_role as enum ('manager', 'salesperson', 'expense_reporter');
create type public.project_code as enum ('A', 'B');
create type public.expense_category as enum ('Materials', 'Travel', 'Other');
create type public.expense_allocation as enum ('A', 'B', 'Company overhead');
create type public.sale_status as enum ('pending_approval', 'approved');
create type public.expense_status as enum ('awaiting_allocation', 'allocated');
create type public.delivery_status as enum ('not_required', 'pending', 'sent', 'failed');
create type public.sync_status as enum ('pending', 'synced', 'failed');

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  role public.employee_role not null,
  telegram_user_id text unique,
  telegram_chat_id text,
  created_at timestamptz not null default now(),
  constraint employee_telegram_pair check ((telegram_user_id is null) = (telegram_chat_id is null))
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^S[0-9]{2,}$'),
  submitted_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id),
  submitter_name text not null,
  telegram_chat_id text,
  customer text not null check (length(trim(customer)) > 0),
  project public.project_code not null,
  description text not null check (length(trim(description)) > 0),
  amount_cents integer not null check (amount_cents > 0),
  proposed_richard numeric(5,2) not null check (proposed_richard between 0 and 100),
  proposed_anastasia numeric(5,2) not null check (proposed_anastasia between 0 and 100),
  proposed_jean_claude numeric(5,2) not null check (proposed_jean_claude between 0 and 100),
  approved_richard numeric(5,2),
  approved_anastasia numeric(5,2),
  approved_jean_claude numeric(5,2),
  commission_richard_cents integer not null default 0 check (commission_richard_cents >= 0),
  commission_anastasia_cents integer not null default 0 check (commission_anastasia_cents >= 0),
  commission_jean_claude_cents integer not null default 0 check (commission_jean_claude_cents >= 0),
  status public.sale_status not null default 'pending_approval',
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  split_changed boolean not null default false,
  sheet_sync public.sync_status not null default 'pending',
  sheet_sync_error text,
  notification_status public.delivery_status not null default 'pending',
  notification_error text,
  constraint sale_proposal_sums_to_100 check (proposed_richard + proposed_anastasia + proposed_jean_claude = 100),
  constraint sale_approval_shape check (
    (status = 'pending_approval' and approved_richard is null and approved_anastasia is null and approved_jean_claude is null and approved_by is null and approved_at is null and commission_richard_cents = 0 and commission_anastasia_cents = 0 and commission_jean_claude_cents = 0)
    or
    (status = 'approved' and approved_richard between 0 and 100 and approved_anastasia between 0 and 100 and approved_jean_claude between 0 and 100 and approved_richard + approved_anastasia + approved_jean_claude = 100 and approved_by is not null and approved_at is not null)
  )
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^E[0-9]{2,}$'),
  submitted_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id),
  submitter_name text not null,
  telegram_chat_id text,
  description text not null check (length(trim(description)) > 0),
  category public.expense_category not null,
  amount_cents integer not null check (amount_cents > 0),
  proposed_allocation public.expense_allocation not null,
  final_allocation public.expense_allocation,
  status public.expense_status not null,
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  allocation_changed boolean not null default false,
  sheet_sync public.sync_status not null default 'pending',
  sheet_sync_error text,
  notification_status public.delivery_status not null default 'not_required',
  notification_error text,
  constraint expense_decision_shape check (
    (status = 'awaiting_allocation' and proposed_allocation <> 'Company overhead' and final_allocation is null and approved_by is null and approved_at is null)
    or
    (status = 'allocated' and final_allocation is not null and approved_by is not null and approved_at is not null)
  ),
  constraint overhead_allocated_automatically check (
    proposed_allocation <> 'Company overhead' or
    (status = 'allocated' and final_allocation = 'Company overhead')
  )
);

create index sales_status_idx on public.sales(status);
create index expenses_status_idx on public.expenses(status);
create index sales_employee_idx on public.sales(employee_id, submitted_at desc);
create index expenses_employee_idx on public.expenses(employee_id, submitted_at desc);

insert into public.employees (slug, display_name, role) values
  ('svetlana', 'Svetlana de Monte Carlo', 'manager'),
  ('richard', 'Richard “Call Me Dick” Darling', 'salesperson'),
  ('anastasia', 'Anastasia Ferrari', 'salesperson'),
  ('jean-claude', 'Jean-Claude Bērziņš', 'salesperson'),
  ('kevin', 'Kevin von Whatever', 'expense_reporter')
on conflict (slug) do update set display_name = excluded.display_name, role = excluded.role;

alter table public.employees enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
revoke all on public.employees, public.sales, public.expenses from anon, authenticated;
grant all on public.employees, public.sales, public.expenses to service_role;

create view public.financial_summary with (security_invoker = true) as
with approved_sales as (
  select project,
         sum(amount_cents)::bigint as income_cents,
         sum(commission_richard_cents + commission_anastasia_cents + commission_jean_claude_cents)::bigint as commissions_cents,
         sum(commission_richard_cents)::bigint as richard_cents,
         sum(commission_anastasia_cents)::bigint as anastasia_cents,
         sum(commission_jean_claude_cents)::bigint as jean_claude_cents
  from public.sales where status = 'approved' group by project
), allocated_expenses as (
  select final_allocation, sum(amount_cents)::bigint as amount_cents
  from public.expenses where status = 'allocated' group by final_allocation
), pending_expenses as (
  select coalesce(sum(amount_cents), 0)::bigint as amount_cents
  from public.expenses where status = 'awaiting_allocation'
), sales_totals as (
  select coalesce(sum(amount_cents), 0)::bigint as income_cents,
         coalesce(sum(commission_richard_cents), 0)::bigint as richard_cents,
         coalesce(sum(commission_anastasia_cents), 0)::bigint as anastasia_cents,
         coalesce(sum(commission_jean_claude_cents), 0)::bigint as jean_claude_cents
  from public.sales where status = 'approved'
), expense_total as (
  select coalesce(sum(amount_cents), 0)::bigint as amount_cents from public.expenses
)
select p.project,
       coalesce(s.income_cents, 0) as approved_income_cents,
       coalesce(s.commissions_cents, 0) as commissions_cents,
       coalesce(e.amount_cents, 0) as allocated_expenses_cents,
       coalesce(s.income_cents, 0) - coalesce(s.commissions_cents, 0) - coalesce(e.amount_cents, 0) as result_cents,
       coalesce(s.richard_cents, 0) as richard_commission_cents,
       coalesce(s.anastasia_cents, 0) as anastasia_commission_cents,
       coalesce(s.jean_claude_cents, 0) as jean_claude_commission_cents,
       (select coalesce(sum(amount_cents), 0) from allocated_expenses where final_allocation = 'Company overhead') as overhead_cents,
       (select amount_cents from pending_expenses) as awaiting_allocation_cents,
       (select income_cents from sales_totals) - (select richard_cents + anastasia_cents + jean_claude_cents from sales_totals) - (select amount_cents from expense_total) as company_result_cents
from (values ('A'::public.project_code), ('B'::public.project_code)) as p(project)
left join approved_sales s on s.project = p.project
left join allocated_expenses e on e.final_allocation::text = p.project::text;

revoke all on public.financial_summary from anon, authenticated;
grant select on public.financial_summary to service_role;
