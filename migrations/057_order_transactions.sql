-- 057: прив'язка банківських транзакцій (надходжень/витрат) до замовлення.
-- Дає касову, РЕАЛЬНУ прибутковість замовлення = Σ надходжень − Σ витрат
-- за фактичними грошима (суми з ПДВ, як у виписці). Транзакція може чіплятись
-- часткою (одна оплата ділиться між замовленнями). Дочірня до orders (scope через батька).

create table if not exists order_transactions (
  id uuid default gen_random_uuid() primary key,
  order_id uuid not null references orders(id) on delete cascade,
  transaction_id uuid references bank_transactions(id) on delete set null,
  kind text not null,                 -- 'income' | 'expense'
  amount numeric not null default 0,  -- частка суми транзакції на замовлення (фактична, з ПДВ)
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_order_transactions_order on order_transactions (order_id);
create index if not exists idx_order_transactions_tx on order_transactions (transaction_id);

alter table order_transactions enable row level security;
drop policy if exists order_transactions_all on order_transactions;
create policy order_transactions_all on order_transactions for all to authenticated using (true) with check (true);
