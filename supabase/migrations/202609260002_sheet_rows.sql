alter table public.sales
  add column sheet_row integer generated always as identity (start with 2) unique;
alter table public.expenses
  add column sheet_row integer generated always as identity (start with 2) unique;
