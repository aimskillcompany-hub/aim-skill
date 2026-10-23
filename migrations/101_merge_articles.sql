-- 101: «Об'єднати статті» (ТЗ редизайну 6.6, помилка 10: дублі «Операційні витрати» / «Інші операційні витрати» /
-- «Інші витрати», «Внутрішній переказ» / «Переказ коштів між рахунками») — 2026-10-23.
-- merge_articles(p_from, p_to, p_apply):
--   p_apply = false — ПРОБНИЙ запуск, нічого не пише: скільки операцій і на яку суму переїде, по місяцях; скільки лишиться
--     в закритих місяцях; скільки контрагентів має цю статтю за замовчуванням;
--   p_apply = true — переносить операції ЛИШЕ у відкритих місяцях (закриті не чіпає — їхні звіти зафіксовані),
--     статтю за замовчуванням у контрагентів, плани (якщо таблиця є). Саму статтю НЕ видаляє: її можна видалити
--     в Налаштуваннях, коли в ній не лишиться операцій (зокрема в закритих місяцях).
-- Лише адміністратор або бухгалтер (перевірка на сервері): ARTICLE_MERGE_ROLE. Статті мають бути одного типу.
-- UPDATE — лише з конкретним WHERE. Права на таблиці не змінюються. Скрипт можна запускати повторно.
begin;

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

  -- операції статті: за посиланням або (без посилання) за назвою
  create temp table if not exists _merge_tx (id uuid, d date, amount numeric, closed boolean) on commit drop;
  delete from _merge_tx where true;
  insert into _merge_tx
  select t.id, t.date, t.amount, period_is_closed(t.company_id, t.date)
    from bank_transactions t
   where t.article_id = a_from.id
      or (t.article_id is null and lower(regexp_replace(trim(t.article), '\s+', ' ', 'g')) = lower(regexp_replace(trim(a_from.name), '\s+', ' ', 'g')));

  select count(*) filter (where not closed), coalesce(sum(abs(amount)) filter (where not closed), 0), count(*) filter (where closed)
    into v_move, v_move_sum, v_closed from _merge_tx;
  select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n, 'sum', s, 'closed', c) order by m), '[]')
    into v_months
    from (select to_char(d, 'YYYY-MM') m, count(*) n, sum(abs(amount)) s, bool_or(closed) c from _merge_tx group by 1) x;
  select count(*) into v_contr from contractors where lower(trim(default_article)) = lower(trim(a_from.name));

  if p_apply then
    update bank_transactions t set article_id = a_to.id, article = a_to.name
      from _merge_tx x where t.id = x.id and not x.closed;
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
