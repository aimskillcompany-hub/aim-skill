-- 007_mail_section.sql
-- Розділ «Пошта»: зберігання всіх листів (вхідні/вихідні) для перегляду в системі.
-- Заявка створюється з листа окремою дією (AI), вкладення тоді → документи замовлення.
-- Запускати ВРУЧНУ в Supabase Dashboard → SQL Editor.

create table if not exists emails (
  id uuid default gen_random_uuid() primary key,
  message_id text unique not null,        -- Message-ID (дедуплікація синхронізації)
  uid integer,                            -- IMAP UID
  folder text,                            -- INBOX | Sent | …
  direction text not null,                -- 'in' (вхідний) | 'out' (вихідний)
  from_addr text,
  to_addr text,
  cc_addr text,
  subject text,
  body_text text,
  body_html text,
  email_date timestamptz,                 -- дата листа
  has_attachments boolean default false,
  attachments jsonb default '[]'::jsonb,  -- [{filename, contentType, size, storage_path}]
  is_read boolean default false,          -- прочитано в системі (НЕ в поштовому ящику)
  order_id uuid references orders(id) on delete set null,  -- створена з листа заявка
  created_at timestamptz default now()
);

create index if not exists emails_date_idx on emails(email_date desc);
create index if not exists emails_direction_idx on emails(direction);
create index if not exists emails_order_idx on emails(order_id);
create index if not exists emails_msgid_idx on emails(message_id);

alter table emails enable row level security;
drop policy if exists emails_all on emails;
create policy emails_all on emails
  for all to authenticated using (true) with check (true);
