-- 060: зарахування повернень поворотної фінансової допомоги (ПФД).
-- ПФД — транзакції bank_transactions з direction='ПФД':
--   amount > 0 — отримано нами (нам дали в борг); amount < 0 — повернуто нами (ми віддали).
-- Таблиця зв'язує конкретне ПОВЕРНЕННЯ з конкретним ПРИХОДОМ частковою сумою (many-to-many):
--   один прихід може гаситись кількома поверненнями і навпаки.

create table if not exists loan_allocations (
  id uuid default gen_random_uuid() primary key,
  company_id uuid not null default '00000000-0000-0000-0000-000000000001' references companies(id),
  receipt_tx_id uuid not null references bank_transactions(id) on delete cascade, -- прихід ПФД (amount>0)
  return_tx_id  uuid not null references bank_transactions(id) on delete cascade, -- повернення ПФД (amount<0)
  amount numeric not null default 0,  -- скільки з повернення зараховано на цей прихід
  created_at timestamptz default now()
);
create index if not exists idx_loan_alloc_company on loan_allocations (company_id);
create index if not exists idx_loan_alloc_receipt on loan_allocations (receipt_tx_id);
create index if not exists idx_loan_alloc_return  on loan_allocations (return_tx_id);

alter table loan_allocations enable row level security;
drop policy if exists loan_allocations_all on loan_allocations;
create policy loan_allocations_all on loan_allocations for all to authenticated using (true) with check (true);
