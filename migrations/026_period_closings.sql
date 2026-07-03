-- 026: Закриття періоду — заморозка знімка + жорстке блокування змін у закритому місяці.
begin;

create table if not exists period_closings (
  id uuid primary key default gen_random_uuid(),
  period_year int not null,
  period_month int not null,               -- 1..12
  status text not null default 'closed',   -- 'closed' | 'reopened'
  snapshot jsonb,                          -- заморожені цифри (P&L, маржа, склад, баланси, борги)
  notes text,
  closed_at timestamptz default now(),
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  unique (period_year, period_month)
);

alter table period_closings enable row level security;
drop policy if exists period_closings_all on period_closings;
create policy period_closings_all on period_closings for all to authenticated using (true) with check (true);

-- ── Жорстке блокування: не дозволяти запис у закритий місяць ──
-- Для таблиць з колонкою date (stock_movements, bank_transactions)
create or replace function guard_period_by_date() returns trigger as $$
declare d date;
begin
  d := case when tg_op = 'DELETE' then old.date else new.date end;
  if d is not null and exists (
    select 1 from period_closings pc
    where pc.status = 'closed'
      and pc.period_year = extract(year from d)::int
      and pc.period_month = extract(month from d)::int
  ) then
    raise exception 'PERIOD_CLOSED: період %/% закрито. Переоткрийте його в розділі «Закриття періоду», щоб змінювати дані.',
      lpad(extract(month from d)::text, 2, '0'), extract(year from d)::int;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql;

-- Для documents (колонка doc_date)
create or replace function guard_period_by_docdate() returns trigger as $$
declare d date;
begin
  d := case when tg_op = 'DELETE' then old.doc_date else new.doc_date end;
  if d is not null and exists (
    select 1 from period_closings pc
    where pc.status = 'closed'
      and pc.period_year = extract(year from d)::int
      and pc.period_month = extract(month from d)::int
  ) then
    raise exception 'PERIOD_CLOSED: період %/% закрито. Переоткрийте його в розділі «Закриття періоду», щоб змінювати дані.',
      lpad(extract(month from d)::text, 2, '0'), extract(year from d)::int;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql;

drop trigger if exists trg_guard_period on stock_movements;
create trigger trg_guard_period before insert or update or delete on stock_movements
  for each row execute function guard_period_by_date();

drop trigger if exists trg_guard_period on bank_transactions;
create trigger trg_guard_period before insert or update or delete on bank_transactions
  for each row execute function guard_period_by_date();

drop trigger if exists trg_guard_period on documents;
create trigger trg_guard_period before insert or update or delete on documents
  for each row execute function guard_period_by_docdate();

commit;
