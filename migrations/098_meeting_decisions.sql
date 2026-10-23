-- 098: рішення про витрати в протоколах нарад (ТЗ редизайну 6.1).
-- Зараз рішення живуть текстом / jsonb у meeting_minutes.decisions — їх НЕ чіпаємо (лишаються як «обговорення»).
-- Нова таблиця — структуровані рішення: категорія, одержувач, сума, рахунок, строк, відповідальний, статус,
-- зв'язок із платежем. Доступ — лише адміністратор, і на читання, і на зміну (рішення власника 23.10.2026),
-- перевірка на сервері (RLS через is_admin() з міграції 035).
-- Повторний запуск безпечний (if not exists / drop … if exists).

create table if not exists meeting_decisions (
  id uuid default gen_random_uuid() primary key,
  protocol_id uuid not null references meeting_minutes(id) on delete cascade,
  category text not null check (category in ('owner_payout', 'salary', 'agent_fee', 'purchase', 'other')),
  recipient text,                                                    -- кому / на що (вільний текст)
  contractor_id uuid references contractors(id) on delete set null,  -- або контрагент з довідника
  order_ids uuid[] not null default '{}',                            -- для агентських: за які замовлення
  source_account_id uuid references accounts(id) on delete set null, -- з якого рахунку платимо
  amount numeric(14, 2) not null check (amount > 0),
  due_date date,
  responsible_id uuid references profiles(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'paid', 'cancelled')),
  paid_transaction_id uuid references bank_transactions(id) on delete set null,
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- платіж прив'язаний ⇒ рішення сплачене (ручна позначка «сплачено» без платежу теж дозволена)
  constraint meeting_decisions_paid_tx check (paid_transaction_id is null or status = 'paid'),
  constraint meeting_decisions_recipient check (coalesce(btrim(recipient), '') <> '' or contractor_id is not null)
);
create index if not exists idx_meeting_decisions_protocol on meeting_decisions (protocol_id);
create index if not exists idx_meeting_decisions_planned on meeting_decisions (source_account_id, status) where status = 'planned';
create unique index if not exists uq_meeting_decisions_tx on meeting_decisions (paid_transaction_id) where paid_transaction_id is not null;

create or replace function meeting_decisions_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_meeting_decisions_touch on meeting_decisions;
create trigger trg_meeting_decisions_touch before update on meeting_decisions
  for each row execute function meeting_decisions_touch();

alter table meeting_decisions enable row level security;
drop policy if exists meeting_decisions_admin_select on meeting_decisions;
drop policy if exists meeting_decisions_admin_write on meeting_decisions;
create policy meeting_decisions_admin_select on meeting_decisions for select to authenticated using (is_admin());
create policy meeting_decisions_admin_write on meeting_decisions for all to authenticated using (is_admin()) with check (is_admin());
