// Тести міграції 110 (розбиття операції на статті): node migrations/tests_110_pglite.mjs
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const dir = path.dirname(fileURLToPath(import.meta.url))
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const err = async (s, p) => { try { await q(s, p); return null } catch (e) { return e.message } }
const A = '00000000-0000-0000-0000-000000000001'
const U = '00000000-0000-0000-0000-0000000000aa'
await db.exec(`create role authenticated; create role anon;
  create schema auth; create function auth.uid() returns uuid language sql stable as $$ select '${U}'::uuid $$;
  create table companies (id uuid primary key); insert into companies values ('${A}');
  create table profiles (id uuid primary key, role text); insert into profiles values ('${U}', 'admin');
  create table period_closings (company_id uuid, period_year int, period_month int, status text);
  create or replace function period_is_closed(p_company uuid, d date) returns boolean language sql stable as $$
    select d is not null and exists (select 1 from period_closings pc where pc.status='closed' and pc.company_id = p_company
      and pc.period_year = extract(year from d)::int and pc.period_month = extract(month from d)::int) $$;
  create table articles (id uuid primary key default gen_random_uuid(), name text, type text);
  create table bank_transactions (id uuid primary key default gen_random_uuid(), company_id uuid default '${A}', date date, amount numeric,
    direction text, article text, article_id uuid references articles(id) on delete set null);
  create table plans (id serial primary key, article text, article_id uuid, amount numeric);
  create table contractors (id serial primary key, name text, default_article text);
  insert into articles (name, type) values ('Товар', 'expense'), ('Доставка', 'expense'), ('Комісія банку', 'expense'), ('Виручка', 'income');
  insert into bank_transactions (id, date, amount, direction, article) values
    ('00000000-0000-0000-0000-000000000101', '2026-09-10', -1000, 'Витрати', 'Товар'),
    ('00000000-0000-0000-0000-000000000102', '2026-03-10', -500, 'Витрати', 'Товар');
  insert into period_closings values ('${A}', 2026, 3, 'closed');
  create or replace function guard_period_by_date() returns trigger as $$ declare d date; begin
    if tg_op in ('UPDATE','DELETE') and period_is_closed(old.company_id, old.date) then d := old.date;
    elsif tg_op in ('INSERT','UPDATE') and period_is_closed(new.company_id, new.date) then d := new.date; end if;
    if d is not null then raise exception 'PERIOD_CLOSED'; end if; return case when tg_op='DELETE' then old else new end; end; $$ language plpgsql;
  create trigger trg_guard_period before insert or update or delete on bank_transactions for each row execute function guard_period_by_date();`)
for (const f of ['090_article_sync.sql', '101_merge_articles.sql', '110_transaction_splits.sql']) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
await db.exec(fs.readFileSync(path.join(dir, '110_transaction_splits.sql'), 'utf8'))   // повторний запуск
ok('міграція застосовується повторно', true)

const T1 = '00000000-0000-0000-0000-000000000101', T2 = '00000000-0000-0000-0000-000000000102'
const art = async (n) => (await q(`select id from articles where name = $1`, [n])).rows[0].id
const [goods, ship, fee] = [await art('Товар'), await art('Доставка'), await art('Комісія банку')]
const parts = (...a) => JSON.stringify(a.map(([id, amount]) => ({ article_id: id, amount })))
const tx = async (id) => (await q(`select * from bank_transactions where id = $1`, [id])).rows[0]
const sp = async (id) => (await q(`select article, article_id, amount::float8 as amount, company_id from bank_transaction_splits where transaction_id = $1 order by position`, [id])).rows

ok('сума частин не збігається — відмова', /SPLIT_SUM/.test(await err(`select split_transaction($1, $2::jsonb)`, [T1, parts([goods, 900], [ship, 50])]) || ''))
ok('одна частина — відмова', /SPLIT_PARTS/.test(await err(`select split_transaction($1, $2::jsonb)`, [T1, parts([goods, 1000])]) || ''))
ok('частина без статті — відмова', /SPLIT_ARTICLE/.test(await err(`select split_transaction($1, $2::jsonb)`, [T1, JSON.stringify([{ amount: 500 }, { article_id: ship, amount: 500 }])]) || ''))
ok('нульова частина — відмова', /SPLIT_AMOUNT/.test(await err(`select split_transaction($1, $2::jsonb)`, [T1, parts([goods, 1000], [ship, 0])]) || ''))

await q(`select split_transaction($1, $2::jsonb)`, [T1, parts([goods, 900], [ship, 99.5], [fee, 0.5])])
let s = await sp(T1), t = await tx(T1)
ok('розбито: 3 частини зі знаком операції й назвами статей', s.length === 3 && s[0].amount === -900 && s[2].amount === -0.5 && s[1].article === 'Доставка' && s[0].company_id === A)
ok('операція: is_split, без власної статті; сума й напрям ті самі', t.is_split && t.article === null && t.article_id === null && Number(t.amount) === -1000 && t.direction === 'Витрати')

ok('змінити суму розбитої операції — відмова', /SPLIT_LOCKED/.test(await err(`update bank_transactions set amount = -10 where id = $1`, [T1]) || ''))
ok('вписати одну статтю розбитій операції — відмова', /SPLIT_LOCKED/.test(await err(`update bank_transactions set article = 'Товар' where id = $1`, [T1]) || ''))
await q(`update bank_transactions set direction = 'Витрати', date = '2026-09-11' where id = $1`, [T1])
ok('інші поля розбитої операції змінюються', (await tx(T1)).date.toISOString().startsWith('2026-09-11'))

await q(`select split_transaction($1, $2::jsonb)`, [T1, parts([goods, 600], [ship, 400])])
ok('повторне розбиття замінює частини', (await sp(T1)).map(x => x.amount).join() === '-600,-400')

await q(`update articles set name = 'Логістика' where id = $1`, [ship])
ok('перейменування статті → нова назва в частині', (await sp(T1))[1].article === 'Логістика')

// закритий місяць
await q(`update period_closings set status = 'open'`)
await q(`select split_transaction($1, $2::jsonb)`, [T2, parts([goods, 300], [ship, 200])])
await q(`update period_closings set status = 'closed'`)
ok('закритий місяць: розбити — відмова', /PERIOD_CLOSED/.test(await err(`select split_transaction($1, $2::jsonb)`, [T2, parts([goods, 250], [ship, 250])]) || ''))
ok('закритий місяць: змінити частину напряму — відмова', /PERIOD_CLOSED/.test(await err(`update bank_transaction_splits set amount = -1 where transaction_id = $1`, [T2]) || ''))
ok('закритий місяць: скасувати розбиття — відмова', /PERIOD_CLOSED/.test(await err(`select unsplit_transaction($1)`, [T2]) || ''))
await q(`update articles set name = 'Доставка' where id = $1`, [ship])
ok('закритий місяць: перейменування статті оновлює назву в частині', (await sp(T2))[1].article === 'Доставка')

// об'єднання статей: відкритий місяць переїжджає, закритий — ні
const res = (await q(`select merge_articles($1, $2, true) as r`, [ship, goods])).rows[0].r
ok('об\'єднання: частина з відкритого місяця переїхала, із закритого лишилась', res.move === 1 && res.left_in_closed === 1
  && (await sp(T1)).every(x => x.article === 'Товар') && (await sp(T2))[1].article === 'Доставка')

// скасувати
await q(`select unsplit_transaction($1)`, [T1])
t = await tx(T1)
ok('скасування: частини видалено, стаття — найбільшої частини', !t.is_split && t.article === 'Товар' && (await sp(T1)).length === 0)
await q(`select split_transaction($1, $2::jsonb)`, [T1, parts([goods, 600], [fee, 400])])
await q(`select unsplit_transaction($1, $2)`, [T1, fee])
ok('скасування з вибраною статтею', (await tx(T1)).article === 'Комісія банку')

await q(`select split_transaction($1, $2::jsonb)`, [T1, parts([goods, 600], [fee, 400])])
await q(`delete from bank_transactions where id = $1`, [T1])
ok('видалення операції видаляє частини', (await q(`select count(*)::int n from bank_transaction_splits where transaction_id = $1`, [T1])).rows[0].n === 0)
ok('видалення операції в закритому місяці — відмова, частини на місці', /PERIOD_CLOSED/.test(await err(`delete from bank_transactions where id = $1`, [T2]) || '') && (await sp(T2)).length === 2)

console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
process.exit(fails ? 1 : 0)
