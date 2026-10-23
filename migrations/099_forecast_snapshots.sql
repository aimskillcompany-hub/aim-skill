-- 099: знімок прогнозу замовлення (ТЗ редизайну 6.2) — 2026-10-23.
-- Коли замовлення позначають «в прогноз», зберігається НЕЗМІННИЙ знімок плану: виручка без ПДВ, витрати за
-- статтями, прибуток, графік платежів. Пізніші правки замовлення знімок не змінюють. Зняли позначку — знімок
-- стає історичним (is_current = false); поставили знову — новий знімок, старий лишається в історії.
-- Після закриття замовлення знімок порівнюється з фактом («Точність прогнозу»).
-- late = true — знімок зроблено пізніше, ніж замовлення потрапило в прогноз (разово для тих, що вже були
-- в прогнозі до цієї міграції; рішення власника 23.10.2026).
-- Доступ — як у forecast_items (061): усі автентифіковані; права не змінюються.
-- Сервер забороняє правити цифри знімка й видаляти його (поки існує замовлення). Скрипт можна запускати повторно.
begin;

create table if not exists forecast_snapshots (
  id uuid default gen_random_uuid() primary key,
  order_id uuid not null references orders(id) on delete cascade,
  company_id uuid references companies(id),
  taken_at timestamptz not null default now(),
  taken_by uuid references profiles(id) on delete set null default auth.uid(),
  is_current boolean not null default true,
  superseded_at timestamptz,
  late boolean not null default false,
  revenue_net numeric(14, 2) not null default 0,     -- виручка без ПДВ
  costs jsonb not null default '{}',                  -- { purchase, logistics, commission, agent, tax, other } без ПДВ
  profit numeric(14, 2) not null default 0,           -- прогнозний чистий прибуток
  schedule jsonb not null default '[]',               -- [{ date, kind: income|expense, label, amount }]
  client_pay_date date                                -- планова дата оплати клієнта
);
create index if not exists idx_forecast_snapshots_order on forecast_snapshots (order_id, taken_at desc);
create unique index if not exists uq_forecast_snapshots_current on forecast_snapshots (order_id) where is_current;

-- Незмінність: дозволено лише перевести поточний знімок в історію (is_current true → false, superseded_at)
create or replace function forecast_snapshots_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from orders where id = old.order_id) then
      raise exception 'SNAPSHOT_IMMUTABLE: знімок прогнозу не видаляється';
    end if;
    return old;
  end if;
  if new.order_id is distinct from old.order_id or new.company_id is distinct from old.company_id
     or new.taken_at is distinct from old.taken_at or new.taken_by is distinct from old.taken_by
     or new.late is distinct from old.late or new.revenue_net is distinct from old.revenue_net
     or new.costs is distinct from old.costs or new.profit is distinct from old.profit
     or new.schedule is distinct from old.schedule or new.client_pay_date is distinct from old.client_pay_date
     or (new.is_current and not old.is_current) then
    raise exception 'SNAPSHOT_IMMUTABLE: знімок прогнозу не змінюється — зніміть і знову поставте позначку «в прогноз»';
  end if;
  if old.is_current and not new.is_current and new.superseded_at is null then new.superseded_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_forecast_snapshots_guard on forecast_snapshots;
create trigger trg_forecast_snapshots_guard before update or delete on forecast_snapshots
  for each row execute function forecast_snapshots_guard();

alter table forecast_snapshots enable row level security;
drop policy if exists forecast_snapshots_all on forecast_snapshots;
create policy forecast_snapshots_all on forecast_snapshots for all to authenticated using (true) with check (true);

commit;
