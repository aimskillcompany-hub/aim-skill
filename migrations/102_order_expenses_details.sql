-- 102: інші витрати замовлення — деталі для вкладки «Прибутковість» (ТЗ «Прибутковість у замовленні», 2.1) — 2026-10-23.
-- Форма витрати: тип (доставка / монтаж / комісія банку / агентські / інше), з ПДВ чи без, контрагент (необов'язково),
-- дата і (необов'язково) прив'язка до банківської транзакції — тоді витрата потрапляє й у «Факт».
-- Наявні витрати не змінюються: нові колонки порожні / false (vat_included = false — сума без ПДВ, як і досі).
-- Права не змінюються (політика order_expenses_all з 065). Скрипт можна запускати повторно.
begin;

alter table order_expenses add column if not exists kind text;                -- delivery | install | bank_fee | agent | other
alter table order_expenses add column if not exists vat_included boolean not null default false;  -- сума з ПДВ (план ÷ 1,2)
alter table order_expenses add column if not exists contractor_id uuid references contractors(id) on delete set null;
alter table order_expenses add column if not exists expense_date date;
alter table order_expenses add column if not exists transaction_id uuid references bank_transactions(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_expenses_kind_check') then
    alter table order_expenses add constraint order_expenses_kind_check
      check (kind is null or kind in ('delivery', 'install', 'bank_fee', 'agent', 'other'));
  end if;
end $$;
create index if not exists idx_order_expenses_tx on order_expenses (transaction_id) where transaction_id is not null;

commit;
