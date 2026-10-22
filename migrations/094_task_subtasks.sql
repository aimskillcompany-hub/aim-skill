-- 094: підзадачі (чекліст) у задачі (2026-10-22). Одна задача (напр. по замовленню) — кілька пунктів із галочкою,
-- за потреби — окремий виконавець і термін пункту. Прогрес «2/5» — у списку й на канбані.
-- Виконавцю підзадачі — сповіщення (дзвіночок / Telegram, як «призначено»), задача з'являється в його «Мої».
-- Позначка / зняття «виконано» і додавання пункту — в історію задачі.
-- Права — як у задач (усім авторизованим), наявні правила не змінюються. UPDATE / DELETE лише з WHERE.
begin;

create table if not exists task_checklist (
  id uuid default gen_random_uuid() primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid,
  position integer not null default 0,
  assignee_id uuid references profiles(id) on delete set null,
  due_date date,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists idx_task_checklist_task on task_checklist (task_id, position);
create index if not exists idx_task_checklist_assignee on task_checklist (assignee_id) where not done;
alter table task_checklist enable row level security;
drop policy if exists task_checklist_all on task_checklist;
create policy task_checklist_all on task_checklist for all to authenticated using (true) with check (true);

create or replace function trg_task_checklist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- видаляють сам пункт (а не всю задачу каскадом) — записати в історію
    if exists (select 1 from tasks where id = old.task_id) then
      insert into task_activity (task_id, action, old_value) values (old.task_id, 'subtask_del', jsonb_build_object('text', old.text));
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.done is distinct from old.done then
    new.done_at := case when new.done then now() end;
    new.done_by := case when new.done then auth.uid() end;
  end if;
  return new;
end $$;
drop trigger if exists trg_task_checklist_before on task_checklist;
create trigger trg_task_checklist_before before update or delete on task_checklist for each row execute function trg_task_checklist();

create or replace function trg_task_checklist_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; v_who text := coalesce((select full_name from profiles where id = auth.uid()), 'Хтось');
begin
  select id, title into t from tasks where id = new.task_id;
  if tg_op = 'INSERT' then
    insert into task_activity (task_id, action, new_value) values (new.task_id, 'subtask_add', jsonb_build_object('text', new.text));
  elsif new.done is distinct from old.done then
    insert into task_activity (task_id, action, new_value) values (new.task_id, 'subtask_done', jsonb_build_object('text', new.text, 'done', new.done));
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform task_notify(new.assignee_id, new.task_id, 'assigned', v_who || ' доручив(ла) вам підзадачу', new.text || ' — ' || t.title);
  end if;
  return null;
end $$;
drop trigger if exists trg_task_checklist_after on task_checklist;
create trigger trg_task_checklist_after after insert or update on task_checklist for each row execute function trg_task_checklist_after();

commit;
