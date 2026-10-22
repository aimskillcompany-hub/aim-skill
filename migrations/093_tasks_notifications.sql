-- 093: Планер задач, етап 2 «Нагадування» (ТЗ 22.10.2026; рішення власника: задачі всіх компаній разом, через наявного бота).
--  • notifications — дзвіночок у додатку (Realtime) і черга для Telegram (tg_sent_at).
--  • Події → сповіщення (тригери): призначено; на перевірці; прийнято / повернуто; виконано; новий коментар; @згадка.
--    Собі сповіщення не надсилаються.
--  • task_reminders — заплановані нагадування: за N хвилин до терміну (remind_offsets, типово 24 год і 1 год),
--    у момент терміну (відповідальному й постановнику), «Нагадати мені…», «Відкласти» з Telegram.
--    Перераховуються тригером при зміні терміну / відповідального / статусу / remind_offsets.
--  • process_task_reminders() — щохвилини (pg_cron): нагадування, що настали → сповіщення; прострочені задачі —
--    щодня після 09:00 (Київ) відповідальному й постановнику.
--  • Прив'язка Telegram: profiles.telegram_chat_id (одноразовий код telegram_link_code()), налаштування notify_prefs.
--  • pg_cron + pg_net: щохвилини — обробка нагадувань і, якщо є що надіслати, виклик /api/task-reminders;
--    робочі дні 08:30 (Київ) — ранковий дайджест. Токен виклику — у таблиці app_secrets (лише сервер), не в коді.
-- Права: на НОВІ таблиці — лише свої рядки (notifications, task_reminders); наявні правила не змінюються.
-- UPDATE / DELETE лише з конкретним WHERE; TRUNCATE немає.
begin;

alter table profiles add column if not exists telegram_chat_id bigint;
alter table profiles add column if not exists notify_prefs jsonb not null default '{}';
alter table profiles add column if not exists telegram_link_code text;
alter table profiles add column if not exists telegram_link_expires timestamptz;
alter table profiles add column if not exists digest_sent_on date;
create unique index if not exists idx_profiles_tg_chat on profiles (telegram_chat_id) where telegram_chat_id is not null;
alter table tasks add column if not exists overdue_notified_on date;

create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  kind text not null,          -- assigned | review | accepted | returned | done | comment | mention | due_soon | due | overdue | reminder
  title text not null,
  body text,
  actor_id uuid,
  read_at timestamptz,
  tg_sent_at timestamptz,
  tg_skip boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists idx_notifications_user on notifications (user_id, created_at desc);
create index if not exists idx_notifications_tg on notifications (created_at) where tg_sent_at is null and not tg_skip;
alter table notifications enable row level security;
drop policy if exists notifications_own_read on notifications;
create policy notifications_own_read on notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_own_update on notifications;
create policy notifications_own_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists task_reminders (
  id uuid default gen_random_uuid() primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  remind_at timestamptz not null,
  kind text not null,          -- before:<хв> | due | custom | snooze
  sent_at timestamptz,
  created_at timestamptz default now(),
  unique (task_id, user_id, kind, remind_at)
);
create index if not exists idx_task_reminders_due on task_reminders (remind_at) where sent_at is null;
alter table task_reminders enable row level security;
drop policy if exists task_reminders_own on task_reminders;
create policy task_reminders_own on task_reminders for select to authenticated using (user_id = auth.uid());

create table if not exists app_secrets (key text primary key, value text not null);
alter table app_secrets enable row level security;     -- без політик: читає лише сервер (service role)
insert into app_secrets (key, value) values ('task_notify', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;

-- Realtime для дзвіночка
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    execute 'alter publication supabase_realtime add table notifications';
  end if;
end $$;

-- ── сповіщення ──
create or replace function task_notify(p_user uuid, p_task uuid, p_kind text, p_title text, p_body text default null, p_self boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  if not p_self and p_user = auth.uid() then return; end if;     -- собі — ні
  insert into notifications (user_id, task_id, kind, title, body, actor_id) values (p_user, p_task, p_kind, p_title, p_body, auth.uid());
end $$;

create or replace function trg_task_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_who text := coalesce((select full_name from profiles where id = auth.uid()), 'Хтось');
begin
  if tg_op = 'INSERT' then
    perform task_notify(new.assignee_id, new.id, 'assigned', v_who || ' призначив(ла) вам задачу', new.title);
    return null;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform task_notify(new.assignee_id, new.id, 'assigned', v_who || ' призначив(ла) вам задачу', new.title);
  end if;
  if new.status is distinct from old.status then
    if new.status = 'review' then
      perform task_notify(new.created_by, new.id, 'review', v_who || ' здав(ла) результат на перевірку', new.title);
    elsif old.status = 'review' and new.status = 'done' then
      perform task_notify(new.assignee_id, new.id, 'accepted', 'Результат прийнято', new.title);
    elsif old.status = 'review' and new.status = 'in_progress' then
      perform task_notify(new.assignee_id, new.id, 'returned', 'Задачу повернуто на доопрацювання', new.title);
    elsif new.status = 'done' then
      perform task_notify(new.created_by, new.id, 'done', v_who || ' виконав(ла) задачу', new.title);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_task_notify on tasks;
create trigger trg_task_notify after insert or update on tasks for each row execute function trg_task_notify();

-- коментар: учасникам (крім автора); згаданому через @ім'я — «згадка»
create or replace function trg_task_comment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; u uuid; v_who text; v_mentioned uuid[];
begin
  select * into t from tasks where id = new.task_id;
  v_who := coalesce((select full_name from profiles where id = new.author_id), 'Хтось');
  select coalesce(array_agg(p.id), '{}') into v_mentioned from profiles p
   where coalesce(p.full_name, '') <> ''
     and position(lower('@' || left(split_part(p.full_name, ' ', 1), greatest(length(split_part(p.full_name, ' ', 1)) - 1, 3))) in lower(new.body)) > 0;
  foreach u in array v_mentioned loop
    if u is distinct from new.author_id then
      insert into notifications (user_id, task_id, kind, title, body, actor_id) values (u, t.id, 'mention', v_who || ' згадав(ла) вас: ' || t.title, left(new.body, 500), new.author_id);
    end if;
  end loop;
  for u in select distinct x from unnest(array[t.assignee_id, t.created_by] || coalesce((select array_agg(user_id) from task_watchers where task_id = t.id), '{}')) x loop
    if u is not null and u is distinct from new.author_id and not (u = any (v_mentioned)) then
      insert into notifications (user_id, task_id, kind, title, body, actor_id) values (u, t.id, 'comment', v_who || ' прокоментував(ла): ' || t.title, left(new.body, 500), new.author_id);
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists trg_task_comment_notify on task_comments;
create trigger trg_task_comment_notify after insert on task_comments for each row execute function trg_task_comment_notify();

-- ── заплановані нагадування ──
create or replace function trg_task_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
declare o integer; v_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.due_at is not distinct from old.due_at and new.assignee_id is not distinct from old.assignee_id
     and new.status is not distinct from old.status and new.remind_offsets is not distinct from old.remind_offsets
     and new.created_by is not distinct from old.created_by then
    return null;
  end if;
  delete from task_reminders where task_id = new.id and sent_at is null and (kind like 'before:%' or kind = 'due');
  if new.due_at is null or new.status in ('done', 'cancelled', 'on_hold') then return null; end if;
  foreach o in array coalesce(new.remind_offsets, '{}') loop
    v_at := new.due_at - make_interval(mins => o);
    if v_at > now() and new.assignee_id is not null then
      insert into task_reminders (task_id, user_id, remind_at, kind) values (new.id, new.assignee_id, v_at, 'before:' || o) on conflict do nothing;
    end if;
  end loop;
  if new.due_at > now() then
    insert into task_reminders (task_id, user_id, remind_at, kind)
    select new.id, x, new.due_at, 'due' from unnest(array[new.assignee_id, new.created_by]) x where x is not null
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists trg_task_reminders on tasks;
create trigger trg_task_reminders after insert or update on tasks for each row execute function trg_task_reminders();

-- «Нагадати мені…» / «Відкласти» — лише собі
create or replace function task_remind_me(p_task uuid, p_at timestamptz, p_kind text default 'custom')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Потрібен вхід'; end if;
  if p_at <= now() then raise exception 'Час нагадування має бути в майбутньому'; end if;
  insert into task_reminders (task_id, user_id, remind_at, kind) values (p_task, auth.uid(), p_at, coalesce(p_kind, 'custom')) on conflict do nothing;
end $$;

-- ── обробка (щохвилини) ──
create or replace function process_task_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_today date := (now() at time zone 'Europe/Kyiv')::date; v_due text;
begin
  for r in
    select rm.*, t.title, t.due_at, t.status, t.created_by, t.assignee_id
      from task_reminders rm join tasks t on t.id = rm.task_id
     where rm.sent_at is null and rm.remind_at <= now()
     order by rm.remind_at
     limit 500
     for update of rm skip locked
  loop
    update task_reminders set sent_at = now() where id = r.id;
    continue when r.status in ('done', 'cancelled') and r.kind <> 'custom';
    v_due := to_char(r.due_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI');
    insert into notifications (user_id, task_id, kind, title, body)
    values (r.user_id, r.task_id,
            case when r.kind like 'before:%' then 'due_soon' when r.kind = 'due' then 'due' else 'reminder' end,
            case when r.kind like 'before:%' then 'Термін наближається (' || v_due || ')'
                 when r.kind = 'due' then 'Термін задачі настав (' || v_due || ')'
                 else 'Нагадування' end,
            r.title);
    n := n + 1;
  end loop;

  -- прострочені: щодня після 09:00 за Києвом — відповідальному й постановнику
  if extract(hour from now() at time zone 'Europe/Kyiv') >= 9 then
    for r in
      select t.* from tasks t
       where t.status in ('new', 'in_progress', 'review') and t.due_at < now()
         and (t.overdue_notified_on is null or t.overdue_notified_on < v_today)
       limit 500
    loop
      update tasks set overdue_notified_on = v_today where id = r.id;
      insert into notifications (user_id, task_id, kind, title, body)
      select distinct x, r.id, 'overdue', 'Задачу прострочено (термін ' || to_char(r.due_at at time zone 'Europe/Kyiv', 'DD.MM') || ')', r.title
        from unnest(array[r.assignee_id, r.created_by]) x where x is not null;
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

-- ── прив'язка Telegram і налаштування (лише свій профіль) ──
create or replace function telegram_link_code()
returns text
language plpgsql security definer set search_path = public as $$
declare v text := left(replace(gen_random_uuid()::text, '-', ''), 20);
begin
  if auth.uid() is null then raise exception 'Потрібен вхід'; end if;
  update profiles set telegram_link_code = v, telegram_link_expires = now() + interval '15 minutes' where id = auth.uid();
  return v;
end $$;
create or replace function telegram_unlink()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set telegram_chat_id = null, telegram_link_code = null where id = auth.uid();
end $$;
create or replace function set_notify_prefs(p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set notify_prefs = coalesce(p, '{}') where id = auth.uid();
end $$;

-- нові задачі після цієї міграції отримують нагадування тригером; активним із терміном — створити зараз
insert into task_reminders (task_id, user_id, remind_at, kind)
select t.id, t.assignee_id, t.due_at - make_interval(mins => o), 'before:' || o
  from tasks t cross join lateral unnest(t.remind_offsets) o
 where t.status in ('new', 'in_progress', 'review') and t.assignee_id is not null and t.due_at - make_interval(mins => o) > now()
on conflict do nothing;
insert into task_reminders (task_id, user_id, remind_at, kind)
select t.id, x, t.due_at, 'due' from tasks t cross join lateral unnest(array[t.assignee_id, t.created_by]) x
 where t.status in ('new', 'in_progress', 'review') and x is not null and t.due_at > now()
on conflict do nothing;

do $$
declare f text;
begin
  foreach f in array array['task_notify(uuid, uuid, text, text, text, boolean)', 'process_task_reminders()'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('revoke execute on function %s from authenticated', f);    -- лише сервер / тригери
  end loop;
  foreach f in array array['task_remind_me(uuid, timestamptz, text)', 'telegram_link_code()', 'telegram_unlink()', 'set_notify_prefs(jsonb)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

-- ── Розклад (окремо від транзакції: якщо pg_cron / pg_net не ввімкнені — увімкніть у Supabase → Database → Extensions
--    і запустіть цей блок ще раз; решта міграції вже застосована) ──
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('aim_task_notify', 'aim_task_digest');
select cron.schedule('aim_task_notify', '* * * * *', $cron$
  select process_task_reminders();
  select net.http_post(
           url := 'https://aim-skill.vercel.app/api/task-reminders',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select value from app_secrets where key = 'task_notify')),
           body := '{}'::jsonb)
   where exists (select 1 from notifications n join profiles p on p.id = n.user_id
                  where n.tg_sent_at is null and not n.tg_skip and p.telegram_chat_id is not null and n.created_at > now() - interval '2 days');
$cron$);
-- 08:30 за Києвом у робочі дні: 05:30 і 06:30 UTC (зима / літо) — сервер надсилає лише раз на день, коли в Києві 08:xx
select cron.schedule('aim_task_digest', '30 5,6 * * 1-5', $cron$
  select net.http_post(
           url := 'https://aim-skill.vercel.app/api/task-reminders',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select value from app_secrets where key = 'task_notify')),
           body := '{"digest": true}'::jsonb);
$cron$);
