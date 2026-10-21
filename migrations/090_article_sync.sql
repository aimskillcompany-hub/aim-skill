-- 090: стаття операції — одне джерело (2026-10-22).
-- Звіти (P&L, рух коштів, нарахування, закриття періоду) групують банківські операції за ТЕКСТОМ статті
-- (bank_transactions.article), а довідник — articles з id. Імпорт і автокласифікація пишуть лише текст, тож
-- 60 операцій мали статтю без посилання, а перейменування статті в Налаштуваннях лишало старі назви в операціях —
-- і P&L відносив «невідому» назву до операційних витрат.
-- Тепер база тримає текст і посилання узгодженими:
--  1) операція: вибрано статтю (article_id) → текст = назва статті; вписано текст → article_id = стаття з такою назвою;
--  2) перейменування статті → нова назва в операціях, планах і статті за замовчуванням контрагентів;
--     нова стаття → до неї прив'язуються операції з такою самою назвою без посилання;
--  3) заповнення посилань у наявних операціях за назвою (текст — те, за чим звіти рахували досі, не змінюється).
-- Закриті місяці: дозволено змінювати ЛИШЕ назву / посилання статті (суми, дати, напрямки — ні), і лише цими
-- функціями (aim.article_sync). UPDATE лише з конкретним WHERE; DELETE і TRUNCATE немає.
begin;

-- стаття за назвою (без регістру й зайвих пробілів); null — якщо немає або кілька однакових
create or replace function article_id_by_name(p_name text)
returns uuid
language sql stable security invoker set search_path = public as $$
  select case when count(*) = 1 then (array_agg(a.id))[1] end
    from articles a
   where lower(regexp_replace(trim(a.name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'))
     and trim(coalesce(p_name, '')) <> ''
$$;

-- захист закритого місяця: дозволити лише синхронізацію статті (інші поля не змінюються)
create or replace function guard_period_by_date() returns trigger as $$
declare d date;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('aim.article_sync', true), '') = 'on'
     and (to_jsonb(new) - 'article' - 'article_id') = (to_jsonb(old) - 'article' - 'article_id') then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and period_is_closed(old.company_id, old.date) then d := old.date;
  elsif tg_op in ('INSERT', 'UPDATE') and period_is_closed(new.company_id, new.date) then d := new.date;
  end if;
  if d is not null then
    raise exception 'PERIOD_CLOSED: період %/% закрито. Переоткрийте його в розділі «Закриття періоду», щоб змінювати дані.',
      lpad(extract(month from d)::text, 2, '0'), extract(year from d)::int;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql set search_path = public;

-- 1) операція: текст ↔ посилання
create or replace function trg_bank_article_sync() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_name text; v_id uuid;
begin
  if coalesce(current_setting('aim.article_backfill', true), '') = 'on' then return new; end if;   -- заповнення посилань: текст не чіпати
  if new.article_id is not null and (tg_op = 'INSERT' or new.article_id is distinct from old.article_id) then
    select name into v_name from articles where id = new.article_id;
    if v_name is not null then new.article := v_name; end if;
  elsif tg_op = 'INSERT' or new.article is distinct from old.article then
    if trim(coalesce(new.article, '')) = '' then
      new.article_id := null;
    else
      v_id := article_id_by_name(new.article);
      new.article_id := v_id;                       -- немає такої статті → посилання порожнє (видно в перевірці)
      if v_id is not null then select name into new.article from articles where id = v_id; end if;   -- точна назва
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_bank_article_sync on bank_transactions;
create trigger trg_bank_article_sync before insert or update of article, article_id on bank_transactions
  for each row execute function trg_bank_article_sync();

-- 2) перейменування / нова стаття
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
drop trigger if exists trg_article_rename on articles;
create trigger trg_article_rename after insert or update of name on articles
  for each row execute function trg_article_rename();

-- 3) наявні операції: посилання за назвою (текст не змінюється — звіти рахують так само, як досі)
select set_config('aim.article_sync', 'on', true);
select set_config('aim.article_backfill', 'on', true);
with fix as (
  update bank_transactions t set article_id = x.aid
    from (select id, article_id_by_name(article) as aid from bank_transactions where trim(coalesce(article, '')) <> '') x
   where t.id = x.id and x.aid is not null and t.article_id is distinct from x.aid
  returning t.id
)
select jsonb_build_object(
  'linked', (select count(*) from fix),
  'without_article_in_directory', (select coalesce(jsonb_agg(jsonb_build_object('article', article, 'operations', n) order by n desc), '[]'::jsonb)
                                     from (select article, count(*) n from bank_transactions
                                            where trim(coalesce(article, '')) <> '' and article_id_by_name(article) is null
                                            group by article) u),
  'text_differs_from_name', (select count(*) from bank_transactions t join articles a on a.id = article_id_by_name(t.article) where t.article is distinct from a.name)   -- регістр / пробіли; вирівняються при перейменуванні статті
) as result;
select set_config('aim.article_backfill', 'off', true);
select set_config('aim.article_sync', 'off', true);

revoke execute on function article_id_by_name(text) from public, anon;
grant execute on function article_id_by_name(text) to authenticated;

commit;
