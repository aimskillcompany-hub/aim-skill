import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001', MAN = 'aaaaaaaa-0000-0000-0000-000000000003', C1 = '00000000-0000-0000-0000-000000000001'
const A = 'bbbbbbbb-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', I = 'bbbbbbbb-0000-0000-0000-000000000003'
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role authenticated;
  create table profiles (id uuid primary key, role text); insert into profiles values ('${ADMIN}', 'admin'), ('${MAN}', 'manager');
  create table articles (id uuid primary key, name text, type text);
  insert into articles values ('${A}', 'Інші операційні витрати', 'expense'), ('${B}', 'Операційні витрати', 'expense'), ('${I}', 'Виручка: товари', 'income');
  create table period_closings (company_id uuid, period_year int, period_month int, status text);
  insert into period_closings values ('${C1}', 2026, 9, 'closed');
  create function period_is_closed(p_company uuid, d date) returns boolean language sql stable as $$
    select d is not null and exists (select 1 from period_closings pc where pc.status = 'closed' and pc.company_id = p_company and pc.period_year = extract(year from d)::int and pc.period_month = extract(month from d)::int) $$;
  create table bank_transactions (id uuid default gen_random_uuid() primary key, company_id uuid, date date, amount numeric, article text, article_id uuid);
  insert into bank_transactions (company_id, date, amount, article, article_id) values
    ('${C1}', '2026-09-10', -100, 'Інші операційні витрати', '${A}'),
    ('${C1}', '2026-10-05', -200, 'Інші операційні витрати', '${A}'),
    ('${C1}', '2026-10-06', -50, ' інші  операційні витрати ', null),
    ('${C1}', '2026-10-07', -70, 'Операційні витрати', '${B}');
  create table contractors (id uuid default gen_random_uuid() primary key, default_article text);
  insert into contractors (default_article) values ('Інші операційні витрати'), ('Оренда');
`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/101_merge_articles.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
await db.exec(`grant all on all tables in schema public to authenticated; grant usage on schema auth to authenticated;`)
const as = async (uid) => { await db.exec(`reset role; select set_config('test.uid', '${uid}', false); set role authenticated;`) }
await as(MAN)
ok('менеджер — відмова', /ARTICLE_MERGE_ROLE/.test(await fail(`select merge_articles('${A}', '${B}', false)`) || ''))
await as(ADMIN)
const dry = (await q(`select merge_articles('${A}', '${B}', false) r`)).rows[0].r
ok('пробний: 2 операції на 250 переїдуть, 1 лишиться в закритому вересні', dry.move === 2 && Number(dry.move_sum) === 250 && dry.left_in_closed === 1)
ok('пробний: 1 контрагент зі статтею за замовчуванням', dry.contractors === 1)
ok('пробний нічого не змінив', (await q(`select count(*)::int n from bank_transactions where article_id = '${B}'`)).rows[0].n === 1)
ok('різні типи — відмова', /ARTICLE_MERGE_TYPE/.test(await fail(`select merge_articles('${A}', '${I}', true)`) || ''))
ok('та сама стаття — відмова', /ARTICLE_MERGE_SAME/.test(await fail(`select merge_articles('${A}', '${A}', true)`) || ''))
await q(`select merge_articles('${A}', '${B}', true)`)
ok('жовтневі операції (і без посилання) — у новій статті', (await q(`select count(*)::int n from bank_transactions where article_id = '${B}' and article = 'Операційні витрати'`)).rows[0].n === 3)
ok('вересень (закритий) не змінено', (await q(`select article_id from bank_transactions where date = '2026-09-10'`)).rows[0].article_id === A)
ok('контрагент — нова стаття за замовчуванням', (await q(`select count(*)::int n from contractors where default_article = 'Операційні витрати'`)).rows[0].n === 1)
ok('стаття-джерело не видалена', (await q(`select count(*)::int n from articles where id = '${A}'`)).rows[0].n === 1)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
