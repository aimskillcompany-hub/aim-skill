-- 064: агентські по видатковій накладній (звіт «Прибутковість реалізації»).
-- Один агент на накладну: % від прибутку накладної (вноситься вручну).
create table if not exists agent_commissions (
  document_id uuid primary key references documents(id) on delete cascade,
  agent_name text,
  percent numeric not null default 0,
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz default now()
);
alter table agent_commissions enable row level security;
drop policy if exists agent_commissions_all on agent_commissions;
create policy agent_commissions_all on agent_commissions for all to authenticated using (true) with check (true);
