-- 095: результат підзадачі — коментар і файли (2026-10-22).
--  • task_checklist: result_text, result_at, result_by.
--  • task_files — файли задачі / підзадачі (сховище documents, шлях tasks/<задача>/<підзадача>/…), до 20 МБ.
--  • Результат підзадачі → історія задачі і сповіщення постановнику й відповідальному задачі (крім автора).
-- Права — як у задач (усім авторизованим), наявні правила не змінюються. UPDATE / DELETE лише з WHERE.
begin;

alter table task_checklist add column if not exists result_text text;
alter table task_checklist add column if not exists result_at timestamptz;
alter table task_checklist add column if not exists result_by uuid;

create table if not exists task_files (
  id uuid default gen_random_uuid() primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  subtask_id uuid references task_checklist(id) on delete cascade,
  storage_path text not null,
  name text not null,
  size integer,
  mime text,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists idx_task_files_task on task_files (task_id);
create index if not exists idx_task_files_subtask on task_files (subtask_id);
alter table task_files enable row level security;
drop policy if exists task_files_all on task_files;
create policy task_files_all on task_files for all to authenticated using (true) with check (true);

-- результат підзадачі: хто й коли (BEFORE), історія та сповіщення (AFTER)
create or replace function trg_task_checklist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from tasks where id = old.task_id) then
      insert into task_activity (task_id, action, old_value) values (old.task_id, 'subtask_del', jsonb_build_object('text', old.text));
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.done is distinct from old.done then
    new.done_at := case when new.done then now() end;
    new.done_by := case when new.done then auth.uid() end;
  end if;
  if tg_op = 'UPDATE' and new.result_text is distinct from old.result_text then
    new.result_at := case when trim(coalesce(new.result_text, '')) <> '' then now() end;
    new.result_by := case when trim(coalesce(new.result_text, '')) <> '' then auth.uid() end;
  end if;
  return new;
end $$;

create or replace function trg_task_checklist_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; v_who text := coalesce((select full_name from profiles where id = auth.uid()), 'Хтось'); u uuid;
begin
  select id, title, created_by, assignee_id into t from tasks where id = new.task_id;
  if tg_op = 'INSERT' then
    insert into task_activity (task_id, action, new_value) values (new.task_id, 'subtask_add', jsonb_build_object('text', new.text));
  elsif new.done is distinct from old.done then
    insert into task_activity (task_id, action, new_value) values (new.task_id, 'subtask_done', jsonb_build_object('text', new.text, 'done', new.done));
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform task_notify(new.assignee_id, new.task_id, 'assigned', v_who || ' доручив(ла) вам підзадачу', new.text || ' — ' || t.title);
  end if;
  if tg_op = 'UPDATE' and new.result_text is distinct from old.result_text and trim(coalesce(new.result_text, '')) <> '' then
    insert into task_activity (task_id, action, new_value) values (new.task_id, 'subtask_result', jsonb_build_object('text', new.text, 'result', left(new.result_text, 300)));
    for u in select distinct x from unnest(array[t.created_by, t.assignee_id]) x where x is not null loop
      perform task_notify(u, new.task_id, 'comment', v_who || ' додав(ла) результат підзадачі «' || new.text || '»', left(new.result_text, 500));
    end loop;
  end if;
  return null;
end $$;

commit;
