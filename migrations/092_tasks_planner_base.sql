-- 092: Планер задач, етап 1 «Основа» (ТЗ від 22.10.2026).
-- Задача отримує: відповідального (рівно один), спостерігачів, статуси Нова → В роботі → На перевірці → Виконано
-- (+ Відкладено, Скасовано), прапорець «Потребує перевірки», результат (текст + тип), коментарі та історію змін,
-- термін з часом (due_at; due_date лишається і синхронізується — на ньому працюють бот і щоденне нагадування),
-- прив'язку до контрагента / замовлення / документа / звірки. Поля етапів 2–3 (нагадування, повторення, мітки)
-- додаються вже зараз, щоб не міняти таблицю двічі.
-- Правила (тригер): «На перевірці» / «Виконано» — лише з текстом результату; «Виконано» при «Потребує перевірки» —
-- лише постановник. Кожна зміна статусу, відповідального, терміну, пріоритету — в історію.
-- Старі задачі: open → «Нова», done → «Виконано»; відповідальний = автор (без автора — перший адміністратор);
-- задачі зі звірки отримують прив'язку entity_type = 'reconciliation'.
-- Права доступу (RLS) не змінюються: нові таблиці — як tasks (усім авторизованим). UPDATE лише з WHERE; TRUNCATE немає.
begin;

alter table tasks add column if not exists assignee_id uuid references profiles(id) on delete set null;
alter table tasks add column if not exists due_at timestamptz;
alter table tasks add column if not exists start_date date;
alter table tasks add column if not exists requires_review boolean not null default false;
alter table tasks add column if not exists result_text text;
alter table tasks add column if not exists result_type text;
alter table tasks add column if not exists result_by uuid;
alter table tasks add column if not exists result_at timestamptz;
alter table tasks add column if not exists completed_at timestamptz;
alter table tasks add column if not exists spent_minutes integer;
alter table tasks add column if not exists recurrence text;          -- етап 3: 'daily' | 'weekly:1,3' | 'monthly:25'
alter table tasks add column if not exists entity_type text;         -- 'counterparty' | 'order' | 'document' | 'reconciliation'
alter table tasks add column if not exists entity_id uuid;
alter table tasks add column if not exists entity_ref text;          -- посилання в застосунку (напр. рядок звірки)
alter table tasks add column if not exists tags text[] not null default '{}';
alter table tasks add column if not exists remind_offsets integer[] not null default '{1440,60}';   -- етап 2
create index if not exists idx_tasks_assignee on tasks (assignee_id);
create index if not exists idx_tasks_created_by on tasks (created_by);

-- ── перенесення старих задач ──
update tasks set status = case when status = 'done' then 'done' else 'new' end
 where status is null or status not in ('new', 'in_progress', 'review', 'done', 'on_hold', 'cancelled');
update tasks set completed_at = coalesce(done_at, created_at) where status = 'done' and completed_at is null;
update tasks set assignee_id = coalesce(created_by,
         (select p.id from profiles p where p.role = 'admin' order by p.created_at limit 1))
 where assignee_id is null;
update tasks set due_at = ((due_date + time '18:00') at time zone 'Europe/Kyiv')
 where due_date is not null and due_at is null;
update tasks set entity_type = 'reconciliation',
       entity_ref = substring(description from 'Звірка:\s*(/inventory/recon\?\S+)')
 where entity_type is null and source = 'recon';
update tasks set priority = 'normal' where priority is null or priority not in ('low', 'normal', 'high', 'urgent');

alter table tasks alter column status set default 'new';
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('new', 'in_progress', 'review', 'done', 'on_hold', 'cancelled'));
alter table tasks drop constraint if exists tasks_priority_check;
alter table tasks add constraint tasks_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));
alter table tasks drop constraint if exists tasks_result_type_check;
alter table tasks add constraint tasks_result_type_check check (result_type is null or result_type in ('full', 'partial', 'failed'));
alter table tasks drop constraint if exists tasks_title_len;
alter table tasks add constraint tasks_title_len check (char_length(title) <= 500) not valid;   -- нові — до 200 у формі; старі не ламаємо

-- ── спостерігачі, коментарі, історія ──
create table if not exists task_watchers (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key (task_id, user_id)
);
create table if not exists task_comments (
  id uuid default gen_random_uuid() primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null default auth.uid(),
  body text not null,
  created_at timestamptz default now()
);
create index if not exists idx_task_comments_task on task_comments (task_id, created_at);
create table if not exists task_activity (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  actor_id uuid default auth.uid(),
  action text not null,         -- created | status | assignee | due | priority | review | result
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_task_activity_task on task_activity (task_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['task_watchers', 'task_comments', 'task_activity'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_all', t);
  end loop;
end $$;

-- ── правила задачі ──
create or replace function trg_task_rules() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_uid);
    new.assignee_id := coalesce(new.assignee_id, new.created_by);
    new.status := coalesce(new.status, 'new');
  end if;
  -- термін: due_at ↔ due_date (Київ; без часу — 18:00)
  if tg_op = 'INSERT' then
    if new.due_at is not null then new.due_date := (new.due_at at time zone 'Europe/Kyiv')::date;
    elsif new.due_date is not null then new.due_at := (new.due_date + time '18:00') at time zone 'Europe/Kyiv'; end if;
  elsif new.due_at is distinct from old.due_at then
    new.due_date := case when new.due_at is null then null else (new.due_at at time zone 'Europe/Kyiv')::date end;
  elsif new.due_date is distinct from old.due_date then
    new.due_at := case when new.due_date is null then null else (new.due_date + time '18:00') at time zone 'Europe/Kyiv' end;
  end if;
  -- результат
  if tg_op = 'INSERT' or new.result_text is distinct from old.result_text then
    if trim(coalesce(new.result_text, '')) <> '' then new.result_at := now(); new.result_by := coalesce(v_uid, new.result_by, new.assignee_id); end if;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status in ('review', 'done') and trim(coalesce(new.result_text, '')) = '' then
      raise exception 'RESULT_REQUIRED: щоб здати або закрити задачу, опишіть результат виконання';
    end if;
    if new.status = 'done' and new.requires_review and v_uid is not null and v_uid is distinct from new.created_by then
      raise exception 'REVIEW_REQUIRED: задача потребує перевірки — прийняти її може лише постановник';
    end if;
    new.completed_at := case when new.status = 'done' then now() else null end;
    new.done_at := new.completed_at;      -- старе поле (бот, звірка)
  end if;
  return new;
end $$;
drop trigger if exists trg_task_rules on tasks;
create trigger trg_task_rules before insert or update on tasks for each row execute function trg_task_rules();

-- ── історія + автор у спостерігачах ──
create or replace function trg_task_activity() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into task_activity (task_id, action, new_value)
    values (new.id, 'created', jsonb_build_object('assignee_id', new.assignee_id, 'status', new.status, 'due_at', new.due_at));
    if new.created_by is not null and new.created_by is distinct from new.assignee_id then
      insert into task_watchers (task_id, user_id) values (new.id, new.created_by) on conflict do nothing;
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into task_activity (task_id, action, old_value, new_value) values (new.id, 'status', to_jsonb(old.status), to_jsonb(new.status));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into task_activity (task_id, action, old_value, new_value) values (new.id, 'assignee', to_jsonb(old.assignee_id), to_jsonb(new.assignee_id));
  end if;
  if new.due_at is distinct from old.due_at then
    insert into task_activity (task_id, action, old_value, new_value) values (new.id, 'due', to_jsonb(old.due_at), to_jsonb(new.due_at));
  end if;
  if new.priority is distinct from old.priority then
    insert into task_activity (task_id, action, old_value, new_value) values (new.id, 'priority', to_jsonb(old.priority), to_jsonb(new.priority));
  end if;
  if new.requires_review is distinct from old.requires_review then
    insert into task_activity (task_id, action, old_value, new_value) values (new.id, 'review', to_jsonb(old.requires_review), to_jsonb(new.requires_review));
  end if;
  if new.result_text is distinct from old.result_text and trim(coalesce(new.result_text, '')) <> '' then
    insert into task_activity (task_id, action, new_value) values (new.id, 'result', jsonb_build_object('type', new.result_type));
  end if;
  return null;
end $$;
drop trigger if exists trg_task_activity on tasks;
create trigger trg_task_activity after insert or update on tasks for each row execute function trg_task_activity();

commit;
