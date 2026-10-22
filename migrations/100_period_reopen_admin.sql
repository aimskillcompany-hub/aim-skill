-- 100: переоткриття закритого місяця — лише адміністратор, з обов'язковою причиною, і журнал закриттів
-- (ТЗ редизайну 6.5; рішення власника 23.10.2026) — 2026-10-23.
-- Блокування змін банку, документів і руху складу в закритому місяці вже є (026 / 070) — тут не змінюється.
--   • period_closings.reopen_reason — причина останнього переоткриття;
--   • перевести місяць із «закрито» в будь-який інший стан може лише адміністратор (is_admin(), міграція 035),
--     і лише з причиною: PERIOD_REOPEN_ADMIN / PERIOD_REOPEN_REASON;
--   • видалити запис закритого місяця не можна (інакше це «тихе» переоткриття): PERIOD_CLOSED_DELETE;
--   • period_close_log — журнал: хто, коли, закрив чи переоткрив, чому. Пишеться лише тригером; читати можуть усі
--     автентифіковані (як period_closings), писати напряму — ніхто.
-- Хто може ЗАКРИВАТИ місяць — не змінюється. Скрипт можна запускати повторно.
begin;

alter table period_closings add column if not exists reopen_reason text;

create table if not exists period_close_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  period_year int not null,
  period_month int not null,
  action text not null check (action in ('close', 'reopen')),
  reason text,
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists idx_period_close_log_period on period_close_log (company_id, period_year, period_month, at desc);
alter table period_close_log enable row level security;
drop policy if exists period_close_log_read on period_close_log;
create policy period_close_log_read on period_close_log for select to authenticated using (true);

create or replace function guard_period_reopen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'closed' then
      raise exception 'PERIOD_CLOSED_DELETE: закритий місяць не видаляється — переоткрийте його (лише адміністратор, з причиною)';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' and new.status is distinct from 'closed' then
    if not is_admin() then
      raise exception 'PERIOD_REOPEN_ADMIN: переоткрити закритий місяць може лише адміністратор';
    end if;
    if coalesce(btrim(new.reopen_reason), '') = '' then
      raise exception 'PERIOD_REOPEN_REASON: вкажіть причину переоткриття';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_period_reopen on period_closings;
create trigger trg_guard_period_reopen before update or delete on period_closings
  for each row execute function guard_period_reopen();

create or replace function log_period_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status is distinct from 'closed' or new.closed_at is distinct from old.closed_at) then
    insert into period_close_log (company_id, period_year, period_month, action, reason)
    values (new.company_id, new.period_year, new.period_month, 'close', new.notes);
  elsif tg_op = 'UPDATE' and old.status = 'closed' and new.status is distinct from 'closed' then
    insert into period_close_log (company_id, period_year, period_month, action, reason)
    values (new.company_id, new.period_year, new.period_month, 'reopen', new.reopen_reason);
  end if;
  return new;
end $$;
drop trigger if exists trg_log_period_close on period_closings;
create trigger trg_log_period_close after insert or update on period_closings
  for each row execute function log_period_close();

commit;
