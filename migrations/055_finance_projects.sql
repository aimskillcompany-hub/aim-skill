-- 055: фінансові результати проекту (касовий, реальний прибуток за фактичними грошима).
-- Адмінська фіча: проект = окрема сутність, до якої чіпляються банківські транзакції
-- (надходження/витрати) частками — транзакція може ділитись між кількома проектами.

create table if not exists finance_projects (
  id uuid default gen_random_uuid() primary key,
  company_id uuid not null default '00000000-0000-0000-0000-000000000001' references companies(id),
  name text not null,
  note text,
  archived_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_finance_projects_company on finance_projects (company_id);

-- Позиції: зв'язок проект ↔ банківська транзакція з часткою суми і роллю.
create table if not exists finance_project_items (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null references finance_projects(id) on delete cascade,
  transaction_id uuid references bank_transactions(id) on delete set null,
  kind text not null,                 -- 'income' | 'expense'
  amount numeric not null default 0,  -- частка суми транзакції, віднесена на проект (фактична, з ПДВ)
  note text,
  created_at timestamptz default now()
);
create index if not exists idx_finance_items_project on finance_project_items (project_id);
create index if not exists idx_finance_items_tx on finance_project_items (transaction_id);

alter table finance_projects enable row level security;
drop policy if exists finance_projects_all on finance_projects;
create policy finance_projects_all on finance_projects for all to authenticated using (true) with check (true);

alter table finance_project_items enable row level security;
drop policy if exists finance_items_all on finance_project_items;
create policy finance_items_all on finance_project_items for all to authenticated using (true) with check (true);
