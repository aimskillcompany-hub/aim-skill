-- 030: задачі (нагадування собі; інтеграція з Telegram-ботом)
create table if not exists tasks (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  due_date date,                          -- термін виконання
  status text default 'open',             -- 'open' | 'done'
  priority text default 'normal',         -- 'low' | 'normal' | 'high'
  created_by uuid references profiles(id) on delete set null,
  source text default 'app',              -- 'app' | 'bot'
  reminded_on date,                       -- дата останнього нагадування в боті (щоб не дублювати)
  done_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_due on tasks (due_date);

alter table tasks enable row level security;
drop policy if exists tasks_all on tasks;
create policy tasks_all on tasks for all to authenticated using (true) with check (true);
