-- 049: тендерна документація замовлення.
-- Окрема від загальних documents — зберігається ЛИШЕ в замовленні, з прив'язкою
-- до ідентифікатора закупівлі (procurement_id). НЕ впливає на облік/борги/P&L.
create table if not exists tender_documents (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade,
  procurement_id text,                 -- ідентифікатор закупівлі (знімок на момент завантаження)
  seq int not null,                    -- порядковий номер у межах замовлення (для нумерації)
  doc_number text,                     -- внутрішній номер: останні 6 цифр закупівлі/seq
  name text,                           -- найменування документа
  out_number text,                     -- вихідний номер документа
  doc_date date,                       -- дата документа
  file_name text,
  storage_path text,                   -- шлях у бакеті documents (tender/<order_id>/...)
  file_type text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_tender_docs_order on tender_documents (order_id);

alter table tender_documents enable row level security;
drop policy if exists tender_docs_all on tender_documents;
create policy tender_docs_all on tender_documents for all to authenticated using (true) with check (true);
