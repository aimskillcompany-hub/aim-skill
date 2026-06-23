-- ═══════════════════════════════════════════════════════════════════
-- AiM Skill — REWRITE v2 · ФАЗА 1 · Additive schema
-- Запусти у Supabase: SQL Editor → Run.
-- БЕЗПЕЧНО ДЛЯ ПРОДАКШНУ: лише нові таблиці/колонки/індекси/в'юхи.
-- Стара апка (гілка main) ігнорує все нове → нічого не ламається.
-- Ідемпотентно: можна запускати повторно.
-- Переміщення рядків (каса→банк, projects→orders, суми документів) — НЕ тут,
-- воно в 002_cutover.sql і запускається при злитті rewrite→main.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- 1. НОВІ ТАБЛИЦІ (у порядку FK-залежностей)
-- ───────────────────────────────────────────────────────────────────

-- 1.1 accounts — банківські рахунки + каса (каса = рахунок type='cash')
create table if not exists accounts (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  type text not null default 'bank' check (type in ('bank','cash')),
  bank_name text,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- 1.2 orders — замовлення клієнтів (центральний модуль), 3 напрямки
create table if not exists orders (
  id uuid default gen_random_uuid() primary key,
  order_number text,
  type text not null check (type in ('trade','service','agent')),
  status text not null default 'new',
  client_id uuid references contractors(id) on delete set null,
  total numeric(15,2) default 0,
  direction text,                       -- довідкове поле з ТЗ (необов'язкове)
  description text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  closed_at timestamptz,
  reminder_sent_at timestamptz
);

-- 1.3 commercial_proposals — КП з версіонуванням
create table if not exists commercial_proposals (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade not null,
  version integer not null default 1,
  items jsonb default '[]'::jsonb,
  total numeric(15,2) default 0,
  status text default 'draft' check (status in ('draft','sent','accepted','rejected')),
  sent_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- 1.4 supplier_orders — субзамовлення дистрибюторам
create table if not exists supplier_orders (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade not null,
  supplier_id uuid references contractors(id) on delete set null,
  status text not null default 'new',
  total numeric(15,2) default 0,
  payment_delay_days integer default 0,
  payment_due_date date,
  created_at timestamptz default now()
);

-- 1.5 supplier_order_items — позиції субзамовлення
create table if not exists supplier_order_items (
  id uuid default gen_random_uuid() primary key,
  supplier_order_id uuid references supplier_orders(id) on delete cascade not null,
  product_id uuid references products(id) on delete set null,
  qty numeric(15,4) not null default 0,
  cost_price numeric(15,2),
  assembly_id uuid references assemblies(id) on delete set null,
  created_at timestamptz default now()
);

-- 1.6 order_documents — зв'язок замовлення ↔ документ (тип у контексті замовлення)
create table if not exists order_documents (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade not null,
  type text check (type in ('contract','spec','invoice','act','delivery_note')),
  document_id uuid references documents(id) on delete cascade,
  created_at timestamptz default now()
);

-- 1.7 transaction_documents — БАГАТО-ДО-БАГАТЬОХ транзакція ↔ документ
--     amount = часткове покриття (один платіж може закривати кілька рахунків)
create table if not exists transaction_documents (
  id uuid default gen_random_uuid() primary key,
  transaction_id uuid references bank_transactions(id) on delete cascade not null,
  document_id uuid references documents(id) on delete cascade not null,
  amount numeric(15,2),
  created_at timestamptz default now(),
  unique (transaction_id, document_id)
);

-- 1.8 notes — нотатки (комунікація) по будь-якій сутності
create table if not exists notes (
  id uuid default gen_random_uuid() primary key,
  entity_type text not null,            -- 'contractor' | 'order' | ...
  entity_id uuid not null,
  text text not null,
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ───────────────────────────────────────────────────────────────────
-- 2. ЕВОЛЮЦІЯ НАЯВНИХ ТАБЛИЦЬ (тільки ADD COLUMN — безпечно)
-- ───────────────────────────────────────────────────────────────────

-- articles: напрямок P&L
alter table articles add column if not exists direction text default 'general'
  check (direction in ('trade','service','agent','general'));

-- contractors: явні прапорці клієнт/постачальник + умови роботи
alter table contractors add column if not exists is_client boolean default false;
alter table contractors add column if not exists is_supplier boolean default false;
alter table contractors add column if not exists payment_delay_days integer default 0;
alter table contractors add column if not exists price_type text;            -- 'net' | 'gross'
alter table contractors add column if not exists contract_valid_until date;

-- contractor_contacts: гарантуємо потрібну структуру (таблиця вже є, порожня)
create table if not exists contractor_contacts (
  id uuid default gen_random_uuid() primary key,
  contractor_id uuid references contractors(id) on delete cascade,
  name text,
  role text,
  phone text,
  email text,
  is_signer boolean default false,
  created_at timestamptz default now()
);
alter table contractor_contacts add column if not exists contractor_id uuid references contractors(id) on delete cascade;
alter table contractor_contacts add column if not exists name text;
alter table contractor_contacts add column if not exists role text;
alter table contractor_contacts add column if not exists phone text;
alter table contractor_contacts add column if not exists email text;
alter table contractor_contacts add column if not exists is_signer boolean default false;

-- products: опис
alter table products add column if not exists description text;

-- documents: документ стає носієм суми/ПДВ/типу/підпису (база для боргів)
alter table documents add column if not exists type text;                    -- invoice/act/delivery_note/contract/spec/...
alter table documents add column if not exists contractor_id uuid references contractors(id) on delete set null;
alter table documents add column if not exists order_id uuid references orders(id) on delete set null;
alter table documents add column if not exists amount numeric(15,2);
alter table documents add column if not exists vat_amount numeric(15,2) default 0;
alter table documents add column if not exists is_signed boolean default false;
alter table documents add column if not exists signed_scan_url text;
alter table documents add column if not exists storage_path text;
alter table documents add column if not exists ocr_data jsonb;
alter table documents add column if not exists direction text;               -- 'receivable' (клієнту) | 'payable' (постачальнику)

-- bank_transactions: FK на рахунок і статтю (текстові поля article/bank_name лишаються для сумісності)
alter table bank_transactions add column if not exists account_id uuid references accounts(id) on delete set null;
alter table bank_transactions add column if not exists article_id uuid references articles(id) on delete set null;

-- transaction_items: зв'язок з документом
alter table transaction_items add column if not exists document_id uuid references documents(id) on delete set null;

-- stock_movements: прив'язка руху до замовлення/субзамовлення
alter table stock_movements add column if not exists order_id uuid references orders(id) on delete set null;
alter table stock_movements add column if not exists supplier_order_id uuid references supplier_orders(id) on delete set null;

-- assemblies: прив'язка збірки до замовлення
alter table assemblies add column if not exists order_id uuid references orders(id) on delete set null;

-- plans: FK на статтю
alter table plans add column if not exists article_id uuid references articles(id) on delete set null;

-- generated_docs: прив'язка до замовлення
alter table generated_docs add column if not exists order_id uuid references orders(id) on delete set null;

-- ───────────────────────────────────────────────────────────────────
-- 3. SEED: рахунки (нова таблиця, стара апка не бачить)
-- ───────────────────────────────────────────────────────────────────
insert into accounts (name, type, bank_name, sort_order)
  select 'ПУМБ','bank','ПУМБ',1     where not exists (select 1 from accounts where name='ПУМБ');
insert into accounts (name, type, bank_name, sort_order)
  select 'Monobank','bank','Monobank',2 where not exists (select 1 from accounts where name='Monobank');
insert into accounts (name, type, bank_name, sort_order)
  select 'Готівка','cash',null,3     where not exists (select 1 from accounts where name='Готівка');

-- ───────────────────────────────────────────────────────────────────
-- 4. БЕЗПЕЧНІ BACKFILL'и (заповнення нових колонок з наявних даних)
-- ───────────────────────────────────────────────────────────────────

-- 4.1 account_id: ПУМБ-позначені → ПУМБ; решта (bank_name null) → ПУМБ (основний рахунок)
--     Mono-транзакцій у наявних даних немає. Якщо частина null насправді Mono — скоригуй вручну.
update bank_transactions b
  set account_id = (select id from accounts where name='ПУМБ')
  where b.account_id is null
    and (b.bank_name ilike '%пумб%' or b.bank_name ilike '%pumb%' or b.bank_name is null);
update bank_transactions b
  set account_id = (select id from accounts where name='Monobank')
  where b.account_id is null and b.bank_name ilike '%mono%';

-- 4.2 article_id з тексту article (точний збіг назви)
update bank_transactions b
  set article_id = a.id
  from articles a
  where b.article_id is null and b.article is not null
    and lower(btrim(b.article)) = lower(btrim(a.name));

-- 4.3 plans.article_id з тексту
update plans p
  set article_id = a.id
  from articles a
  where p.article_id is null and p.article is not null
    and lower(btrim(p.article)) = lower(btrim(a.name));

-- 4.4 contractors прапорці з type
update contractors set is_client   = true where type='client'   and is_client   is distinct from true;
update contractors set is_supplier = true where type='supplier' and is_supplier is distinct from true;

-- 4.5 documents.storage_path з file_path
update documents set storage_path = file_path where storage_path is null and file_path is not null;

-- ───────────────────────────────────────────────────────────────────
-- 5. ІНДЕКСИ (нові; наявні idx_* лишаються)
-- ───────────────────────────────────────────────────────────────────
create index if not exists idx_bank_article_id on bank_transactions(article_id);
create index if not exists idx_bank_account_id on bank_transactions(account_id);
create index if not exists idx_bank_date       on bank_transactions(date desc);
create index if not exists idx_orders_client   on orders(client_id);
create index if not exists idx_orders_status   on orders(status);
create index if not exists idx_orders_type     on orders(type);
create index if not exists idx_suporders_order on supplier_orders(order_id);
create index if not exists idx_suporders_supp  on supplier_orders(supplier_id);
create index if not exists idx_cp_order        on commercial_proposals(order_id);
create index if not exists idx_orderdocs_order on order_documents(order_id);
create index if not exists idx_txdocs_tx       on transaction_documents(transaction_id);
create index if not exists idx_txdocs_doc      on transaction_documents(document_id);
create index if not exists idx_docs_contractor on documents(contractor_id);
create index if not exists idx_docs_order      on documents(order_id);
create index if not exists idx_sm_order        on stock_movements(order_id);
create index if not exists idx_notes_entity    on notes(entity_type, entity_id);

-- ───────────────────────────────────────────────────────────────────
-- 6. VIEWS
-- ───────────────────────────────────────────────────────────────────

-- 6.1 product_stock — підтвердити (вже існує в проді; визначення сумісне)
create or replace view product_stock as
select p.*,
  coalesce(s.stock, 0)    as computed_stock,
  coalesce(s.total_in, 0) as total_in,
  coalesce(s.total_out,0) as total_out
from products p
left join (
  select product_id,
    sum(case when type='in' then quantity when type='out' then -quantity
             when type='adjustment' then quantity else 0 end) as stock,
    sum(case when type='in' then quantity else 0 end) as total_in,
    sum(case when type='out' then quantity else 0 end) as total_out
  from stock_movements group by product_id
) s on s.product_id = p.id;

-- 6.2 contractor_balances — БОРГИ (для валідації Фази 1)
--     Борг = сума документів − сума прив'язаних транзакцій по контрагенту.
--     УВАГА: у наявних даних documents.amount ще порожній (стара БД тримала суми
--     на bank_transactions, не на documents). Тому зараз balance ≈ −(оплати).
--     Реальні борги запрацюють після backfill сум документів (фаза cutover/Aging).
create or replace view contractor_balances as
select
  c.id   as contractor_id,
  c.name,
  c.edrpou,
  coalesce(d.doc_total, 0)            as documents_total,
  coalesce(t.tx_total,  0)            as transactions_total,
  coalesce(d.doc_total,0) - coalesce(t.tx_total,0) as balance
from contractors c
left join (
  select contractor_id, sum(coalesce(amount,0)) as doc_total
  from documents where contractor_id is not null group by contractor_id
) d on d.contractor_id = c.id
left join (
  select contractor_id, sum(coalesce(amount,0)) as tx_total
  from bank_transactions where contractor_id is not null group by contractor_id
) t on t.contractor_id = c.id;

-- ───────────────────────────────────────────────────────────────────
-- 7. RLS на нових таблицях: authenticated має повний доступ (усі ролі)
-- ───────────────────────────────────────────────────────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'accounts','orders','commercial_proposals','supplier_orders',
    'supplier_order_items','order_documents','transaction_documents','notes'
  ] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "auth_all_select" on %I', tbl);
    execute format('drop policy if exists "auth_all_insert" on %I', tbl);
    execute format('drop policy if exists "auth_all_update" on %I', tbl);
    execute format('drop policy if exists "auth_all_delete" on %I', tbl);
    execute format('create policy "auth_all_select" on %I for select to authenticated using (true)', tbl);
    execute format('create policy "auth_all_insert" on %I for insert to authenticated with check (true)', tbl);
    execute format('create policy "auth_all_update" on %I for update to authenticated using (true) with check (true)', tbl);
    execute format('create policy "auth_all_delete" on %I for delete to authenticated using (true)', tbl);
  end loop;
end $$;

commit;

-- ✓ Готово. Далі: запусти `node migrations/validate.mjs` для перевірки цілісності.
