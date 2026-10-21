import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const A = '00000000-0000-0000-0000-000000000001'
await db.exec(`create role authenticated; create role anon;
  create table period_closings (company_id uuid, period_year int, period_month int, status text);
  create or replace function period_is_closed(p_company uuid, d date) returns boolean language sql stable as $$
    select d is not null and exists (select 1 from period_closings pc where pc.status='closed' and pc.company_id = p_company
      and pc.period_year = extract(year from d)::int and pc.period_month = extract(month from d)::int) $$;
  create table articles (id uuid primary key default gen_random_uuid(), name text, type text);
  create table bank_transactions (id serial primary key, company_id uuid default '${A}', date date, amount numeric, article text, article_id uuid references articles(id) on delete set null);
  create table plans (id serial primary key, article text, article_id uuid, amount numeric);
  create table contractors (id serial primary key, name text, default_article text);
  insert into articles (name, type) values ('Собівартість', 'expense'), ('Виручка', 'income'), ('Оренда', 'expense');
  insert into bank_transactions (date, amount, article) values ('2026-03-10', 100, 'Собівартість'), ('2026-03-11', 50, 'собівартість '), ('2026-09-01', 70, 'Господарські витрати'), ('2026-09-02', 10, 'Виручка');
  insert into plans (article, amount) values ('Собівартість', 1000);
  insert into contractors (name, default_article) values ('X', 'Собівартість');
  insert into period_closings values ('${A}', 2026, 3, 'closed');`)
// старий захист (як у 070)
await db.exec(`create or replace function guard_period_by_date() returns trigger as $$ declare d date; begin
  if tg_op in ('UPDATE','DELETE') and period_is_closed(old.company_id, old.date) then d := old.date;
  elsif tg_op in ('INSERT','UPDATE') and period_is_closed(new.company_id, new.date) then d := new.date; end if;
  if d is not null then raise exception 'PERIOD_CLOSED'; end if; return case when tg_op='DELETE' then old else new end; end; $$ language plpgsql;
  create trigger trg_guard_period before insert or update or delete on bank_transactions for each row execute function guard_period_by_date();`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/090_article_sync.sql', 'utf8')
const res = (await db.exec(sql)).find(r => r.rows?.[0]?.result)?.rows[0].result
console.log('    результат:', JSON.stringify(res))
await db.exec(sql)
ok('посилання заповнено (3 операції, зокрема в закритому березні); «Господарські витрати» — у списку без статті', res.linked === 3 && res.without_article_in_directory[0].article === 'Господарські витрати')
const row = async (id) => (await q(`select t.article, a.name from bank_transactions t left join articles a on a.id = t.article_id where t.id = $1`, [id])).rows[0]
ok('текст старих операцій не змінено (звіти рахують як досі)', (await row(2)).article === 'собівартість ')
const err = async (s) => { try { await q(s); return null } catch (e) { return e.message } }
ok('закритий місяць: зміна суми — як і раніше відмова', /PERIOD_CLOSED/.test(await err(`update bank_transactions set amount = 1 where id = 1`) || ''))
ok('закритий місяць: зміна статті напряму (без перейменування) — відмова', /PERIOD_CLOSED/.test(await err(`update bank_transactions set article = 'Оренда' where id = 1`) || ''))
await q(`update articles set name = 'Собівартість товарів' where name = 'Собівартість'`)
ok('перейменування: нова назва в операціях (і в закритому місяці), плані й контрагенті', (await row(1)).article === 'Собівартість товарів' && (await row(2)).article === 'Собівартість товарів'
  && (await q(`select article from plans`)).rows[0].article === 'Собівартість товарів' && (await q(`select default_article from contractors`)).rows[0].default_article === 'Собівартість товарів')
await q(`insert into bank_transactions (date, amount, article) values ('2026-09-05', 5, 'оренда')`)
ok('новий запис лише з текстом (імпорт) → посилання і точна назва', (await row(5)).name === 'Оренда' && (await row(5)).article === 'Оренда')
await q(`update bank_transactions set article_id = (select id from articles where name = 'Виручка') where id = 5`)
ok('вибір статті в інтерфейсі (посилання) → текст = назва', (await row(5)).article === 'Виручка')
await q(`insert into articles (name, type) values ('Господарські витрати', 'expense')`)
ok('нова стаття «Господарські витрати» → підхопила операцію з такою назвою', (await row(3)).name === 'Господарські витрати')
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
