-- 110: розбиття однієї банківської операції на кілька статей (2026-11-09).
-- Операція лишається одним рядком bank_transactions: рахунок, дата, сума, контрагент, прив'язки до документів
-- не змінюються, тож залишки рахунків і борги рахуються як раніше. Статті й суми — у частинах
-- bank_transaction_splits; звіти за статтями (P&L, рух коштів, нарахування, закриття періоду) рахують частини.
-- Напрям (Доходи / Витрати / ПФД / Інше / ОЗ) — спільний для всіх частин, береться з операції.
--  * split_transaction(p_tx, p_parts) — розбити або змінити розбиття: ≥ 2 частини, кожна зі статтею з довідника,
--    сума частин = сума операції, знак частин = знак операції. Стаття самої операції стає порожньою, is_split = true.
--  * unsplit_transaction(p_tx, p_article_id) — скасувати: частини видаляються, операції повертається одна стаття
--    (передана або стаття найбільшої частини).
--  * Поки операцію розбито, змінити її суму або вписати їй одну статтю не можна (SPLIT_LOCKED): спершу скасувати.
--  * Закритий місяць (за датою операції) — частини не змінюються (PERIOD_CLOSED); перейменування й об'єднання
--    статей оновлюють назви в частинах так само, як в операціях (090, 101).
-- Скрипт можна запускати повторно. DELETE — лише з конкретним WHERE.
begin;

alter table bank_transactions add column if not exists is_split boolean not null default false;

create table if not exists bank_transaction_splits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default '00000000-0000-0000-0000-000000000001' references companies(id),
  transaction_id uuid not null references bank_transactions(id) on delete cascade,
  article text,
  article_id uuid references articles(id) on delete set null,
  amount numeric not null,
  position int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_tx_splits_tx on bank_transaction_splits (transaction_id);
create index if not exists idx_tx_splits_article on bank_transaction_splits (article_id);

alter table bank_transaction_splits enable row level security;
drop policy if exists bank_transaction_splits_all on bank_transaction_splits;
create policy bank_transaction_splits_all on bank_transaction_splits for all to authenticated using (true) with check (true);

-- стаття частини: текст ↔ посилання (та сама функція, що й для операцій, 090)
drop trigger if exists trg_split_article_sync on bank_transaction_splits;
create trigger trg_split_article_sync before insert or update of article, article_id on bank_transaction_splits
  for each row execute function trg_bank_article_sync();

-- частини: компанія — з операції; закритий місяць операції — без змін (крім синхронізації назви статті)
create or replace function trg_split_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare t bank_transactions%rowtype;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('aim.article_sync', true), '') = 'on'
     and (to_jsonb(new) - 'article' - 'article_id') = (to_jsonb(old) - 'article' - 'article_id') then
    return new;
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('aim.split_cascade', true), '') = 'on' then return old; end if;
  select * into t from bank_transactions where id = case when tg_op = 'DELETE' then old.transaction_id else new.transaction_id end;
  if t.id is not null and period_is_closed(t.company_id, t.date) then
    raise exception 'PERIOD_CLOSED: період %/% закрито. Переоткрийте його в розділі «Закриття періоду», щоб змінювати дані.',
      lpad(extract(month from t.date)::text, 2, '0'), extract(year from t.date)::int;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if t.id is not null then new.company_id := t.company_id; end if;
  return new;
end $$;
drop trigger if exists trg_split_guard on bank_transaction_splits;
create trigger trg_split_guard before insert or update or delete on bank_transaction_splits
  for each row execute function trg_split_guard();

-- розбита операція: сума й одна стаття заблоковані, доки розбиття не скасовано
create or replace function trg_bank_split_lock() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if old.is_split and new.is_split then
    if new.amount is distinct from old.amount then
      raise exception 'SPLIT_LOCKED: операцію розбито на статті — щоб змінити суму, спершу скасуйте розбиття';
    end if;
    if trim(coalesce(new.article, '')) <> '' or new.article_id is not null then
      raise exception 'SPLIT_LOCKED: операцію розбито на статті — щоб вказати одну статтю, скасуйте розбиття';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_bank_split_lock on bank_transactions;
create trigger trg_bank_split_lock before update on bank_transactions
  for each row execute function trg_bank_split_lock();

-- видалення операції: частини видаляються каскадом без перевірки місяця (саму операцію вже перевірив її тригер)
create or replace function trg_bank_split_cascade() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  perform set_config('aim.split_cascade', 'on', true);
  delete from bank_transaction_splits where transaction_id = old.id;
  perform set_config('aim.split_cascade', 'off', true);
  return old;
end $$;
drop trigger if exists trg_bank_split_cascade on bank_transactions;
create trigger trg_bank_split_cascade before delete on bank_transactions
  for each row when (old.is_split) execute function trg_bank_split_cascade();

-- розбити / змінити розбиття. p_parts = [{"article_id": "…", "amount": 120.50}, …] (суми — модулем або зі знаком операції)
create or replace function split_transaction(p_tx uuid, p_parts jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  t bank_transactions%rowtype; v_sign int; v_sum numeric := 0; v_n int; p jsonb; v_amt numeric; v_pos int := 0;
begin
  select * into t from bank_transactions where id = p_tx for update;
  if t.id is null then raise exception 'SPLIT_NOT_FOUND: операцію не знайдено'; end if;
  if coalesce(t.amount, 0) = 0 then raise exception 'SPLIT_ZERO: операцію з нульовою сумою не розбивають'; end if;
  if jsonb_typeof(p_parts) is distinct from 'array' then raise exception 'SPLIT_PARTS: передайте список частин'; end if;
  v_n := jsonb_array_length(p_parts);
  if v_n < 2 then raise exception 'SPLIT_PARTS: потрібно щонайменше дві частини'; end if;
  v_sign := sign(t.amount);
  for p in select * from jsonb_array_elements(p_parts) loop
    v_amt := abs(nullif(p->>'amount', '')::numeric);
    if v_amt is null or v_amt = 0 then raise exception 'SPLIT_AMOUNT: у кожній частині має бути сума більше нуля'; end if;
    if nullif(p->>'article_id', '') is null or not exists (select 1 from articles where id = (p->>'article_id')::uuid) then
      raise exception 'SPLIT_ARTICLE: у кожній частині оберіть статтю з довідника';
    end if;
    v_sum := v_sum + round(v_amt, 2);
  end loop;
  if abs(v_sum - abs(t.amount)) > 0.005 then
    raise exception 'SPLIT_SUM: сума частин (%) не дорівнює сумі операції (%)', v_sum, abs(t.amount);
  end if;

  delete from bank_transaction_splits where transaction_id = t.id;
  for p in select * from jsonb_array_elements(p_parts) loop
    v_pos := v_pos + 1;
    insert into bank_transaction_splits (transaction_id, company_id, article_id, amount, position)
    values (t.id, t.company_id, (p->>'article_id')::uuid, v_sign * round(abs((p->>'amount')::numeric), 2), v_pos);
  end loop;
  update bank_transactions set is_split = true, article = null, article_id = null where id = t.id;
  return jsonb_build_object('transaction_id', t.id, 'parts', v_n);
end $$;

-- скасувати розбиття: одна стаття (передана або найбільшої частини)
create or replace function unsplit_transaction(p_tx uuid, p_article_id uuid default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare t bank_transactions%rowtype; v_art uuid;
begin
  select * into t from bank_transactions where id = p_tx for update;
  if t.id is null then raise exception 'SPLIT_NOT_FOUND: операцію не знайдено'; end if;
  if not t.is_split then return jsonb_build_object('transaction_id', t.id, 'changed', false); end if;
  v_art := coalesce(p_article_id, (select article_id from bank_transaction_splits where transaction_id = t.id
                                    order by abs(amount) desc, position limit 1));
  delete from bank_transaction_splits where transaction_id = t.id;
  update bank_transactions set is_split = false, article_id = v_art,
         article = (select name from articles where id = v_art) where id = t.id;
  return jsonb_build_object('transaction_id', t.id, 'changed', true);
end $$;

revoke all on function split_transaction(uuid, jsonb) from public, anon;
revoke all on function unsplit_transaction(uuid, uuid) from public, anon;
grant execute on function split_transaction(uuid, jsonb) to authenticated;
grant execute on function unsplit_transaction(uuid, uuid) to authenticated;

-- перейменування / нова стаття (090) — тепер і в частинах
create or replace function trg_article_rename() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_prev text;
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then return null; end if;
  v_prev := coalesce(current_setting('aim.article_sync', true), '');
  perform set_config('aim.article_sync', 'on', true);
  if tg_op = 'UPDATE' then
    update bank_transactions set article = new.name
     where article_id = new.id and article is distinct from new.name;
    update bank_transaction_splits set article = new.name
     where article_id = new.id and article is distinct from new.name;
    if to_regclass('public.plans') is not null then
      execute 'update plans set article = $1 where (article_id = $2 or (article_id is null and lower(trim(article)) = lower(trim($3)))) and article is distinct from $1'
        using new.name, new.id, old.name;
    end if;
    update contractors set default_article = new.name
     where lower(trim(default_article)) = lower(trim(old.name));
  end if;
  -- операції з такою самою назвою, ще без посилання
  update bank_transactions set article_id = new.id
   where article_id is null and lower(regexp_replace(trim(article), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.name), '\s+', ' ', 'g'))
     and article_id_by_name(new.name) = new.id;
  perform set_config('aim.article_sync', v_prev, true);
  return null;
end $$;

-- об'єднання статей (101) — тепер і частини операцій у відкритих місяцях
create or replace function merge_articles(p_from uuid, p_to uuid, p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a_from articles%rowtype; a_to articles%rowtype;
  v_months jsonb; v_move int; v_move_sum numeric; v_closed int; v_contr int; v_plans int := 0;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'accountant')) then
    raise exception 'ARTICLE_MERGE_ROLE: об''єднувати статті може лише адміністратор або бухгалтер';
  end if;
  select * into a_from from articles where id = p_from;
  select * into a_to from articles where id = p_to;
  if a_from.id is null or a_to.id is null then raise exception 'ARTICLE_MERGE_NOT_FOUND: статтю не знайдено'; end if;
  if a_from.id = a_to.id then raise exception 'ARTICLE_MERGE_SAME: оберіть іншу статтю'; end if;
  if a_from.type is distinct from a_to.type then
    raise exception 'ARTICLE_MERGE_TYPE: статті різного типу (% і %) не об''єднуються', a_from.type, a_to.type;
  end if;

  -- операції й частини операцій статті: за посиланням або (без посилання) за назвою
  create temp table if not exists _merge_tx (id uuid, is_part boolean, d date, amount numeric, closed boolean) on commit drop;
  delete from _merge_tx where true;
  insert into _merge_tx
  select t.id, false, t.date, t.amount, period_is_closed(t.company_id, t.date)
    from bank_transactions t
   where t.article_id = a_from.id
      or (t.article_id is null and lower(regexp_replace(trim(t.article), '\s+', ' ', 'g')) = lower(regexp_replace(trim(a_from.name), '\s+', ' ', 'g')));
  insert into _merge_tx
  select s.id, true, t.date, s.amount, period_is_closed(t.company_id, t.date)
    from bank_transaction_splits s join bank_transactions t on t.id = s.transaction_id
   where s.article_id = a_from.id
      or (s.article_id is null and lower(regexp_replace(trim(s.article), '\s+', ' ', 'g')) = lower(regexp_replace(trim(a_from.name), '\s+', ' ', 'g')));

  select count(*) filter (where not closed), coalesce(sum(abs(amount)) filter (where not closed), 0), count(*) filter (where closed)
    into v_move, v_move_sum, v_closed from _merge_tx;
  select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n, 'sum', s, 'closed', c) order by m), '[]')
    into v_months
    from (select to_char(d, 'YYYY-MM') m, count(*) n, sum(abs(amount)) s, bool_or(closed) c from _merge_tx group by 1) x;
  select count(*) into v_contr from contractors where lower(trim(default_article)) = lower(trim(a_from.name));

  if p_apply then
    update bank_transactions t set article_id = a_to.id, article = a_to.name
      from _merge_tx x where t.id = x.id and not x.is_part and not x.closed;
    update bank_transaction_splits s set article_id = a_to.id, article = a_to.name
      from _merge_tx x where s.id = x.id and x.is_part and not x.closed;
    update contractors set default_article = a_to.name where lower(trim(default_article)) = lower(trim(a_from.name));
    if to_regclass('public.plans') is not null then
      execute 'update plans set article = $1, article_id = $2 where article_id = $3 or (article_id is null and lower(trim(article)) = lower(trim($4)))'
        using a_to.name, a_to.id, a_from.id, a_from.name;
      get diagnostics v_plans = row_count;
    end if;
  end if;

  return jsonb_build_object('from', a_from.name, 'to', a_to.name, 'applied', p_apply,
    'move', v_move, 'move_sum', v_move_sum, 'left_in_closed', v_closed, 'contractors', v_contr, 'plans', v_plans, 'months', v_months);
end $$;

revoke all on function merge_articles(uuid, uuid, boolean) from public;
grant execute on function merge_articles(uuid, uuid, boolean) to authenticated;

commit;
