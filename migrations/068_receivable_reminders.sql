-- 068: журнал нагадувань про заборгованість (звіт по дебіторці по контрагенту).
-- Пишеться при завантаженні PDF/Excel або копіюванні тексту нагадування.
-- У рядку контрагента в «Дебіторці» показується «останнє нагадування».
begin;

create table if not exists receivable_reminders (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,   -- наша юрособа (кому винні)
  contractor_id uuid references contractors(id) on delete cascade, -- боржник
  as_of date,                         -- «станом на»
  total numeric not null default 0,   -- борг на момент нагадування
  overdue numeric not null default 0, -- з них прострочено
  doc_count integer,
  channel text,                       -- 'pdf' | 'xlsx' | 'text'
  created_by uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz default now()
);
create index if not exists idx_recv_reminders_contractor on receivable_reminders (contractor_id, created_at desc);

alter table receivable_reminders enable row level security;
drop policy if exists receivable_reminders_all on receivable_reminders;
create policy receivable_reminders_all on receivable_reminders for all to authenticated using (true) with check (true);

commit;
