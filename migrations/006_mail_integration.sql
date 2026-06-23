-- 006_mail_integration.sql
-- Інтеграція корпоративної пошти (Hostinger IMAP/SMTP).
-- Вхідні: дедуплікація оброблених листів. Вихідні: журнал надсилань.
-- Запускати ВРУЧНУ в Supabase Dashboard → SQL Editor.

-- Джерело документа (email | manual | generated | …) — для фільтра/аудиту
alter table documents add column if not exists source text;

-- ── Дедуплікація вхідних листів ──
create table if not exists processed_emails (
  id uuid default gen_random_uuid() primary key,
  message_id text unique not null,        -- Message-ID листа (ключ дедуплікації)
  uid integer,                            -- IMAP UID (в межах поточного INBOX)
  subject text,
  from_addr text,
  doc_count integer default 0,            -- скільки документів створено з листа
  status text default 'ok',               -- ok | error
  error text,
  processed_at timestamptz default now()
);

-- ── Журнал вихідних листів ──
create table if not exists mail_log (
  id uuid default gen_random_uuid() primary key,
  direction text default 'out',           -- out (надсилання) | in (службово)
  to_addr text,
  cc_addr text,
  subject text,
  document_id uuid references documents(id) on delete set null,
  contractor_id uuid references contractors(id) on delete set null,
  status text default 'sent',             -- sent | error
  error text,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists mail_log_document_idx on mail_log(document_id);
create index if not exists mail_log_contractor_idx on mail_log(contractor_id);
create index if not exists processed_emails_msgid_idx on processed_emails(message_id);

-- ── RLS: authenticated повний доступ (як решта таблиць) ──
alter table processed_emails enable row level security;
alter table mail_log enable row level security;

drop policy if exists processed_emails_all on processed_emails;
create policy processed_emails_all on processed_emails
  for all to authenticated using (true) with check (true);

drop policy if exists mail_log_all on mail_log;
create policy mail_log_all on mail_log
  for all to authenticated using (true) with check (true);
