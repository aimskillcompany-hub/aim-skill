import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001', ACC = 'aaaaaaaa-0000-0000-0000-000000000002', C1 = '00000000-0000-0000-0000-000000000001'
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role authenticated;
  create table profiles (id uuid primary key, role text);
  insert into profiles values ('${ADMIN}', 'admin'), ('${ACC}', 'accountant');
  create function is_admin() returns boolean language sql security definer stable as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;
  create table bank_transactions (id uuid default gen_random_uuid() primary key, company_id uuid, date date, amount numeric);
  create table documents (id uuid default gen_random_uuid() primary key, company_id uuid, doc_date date, created_at timestamptz default now(), amount numeric);
  create table stock_movements (id uuid default gen_random_uuid() primary key, company_id uuid, date date, quantity numeric);
`)
// справжні 026 (таблиця й тригери блокування) і функції блокування з 070 (по юрособі)
await db.exec(fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/026_period_closings.sql', 'utf8'))
await db.exec(`alter table period_closings add column if not exists company_id uuid default '${C1}'`)
const m070 = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/070_atomic_ops_period_by_company.sql', 'utf8')
const guards = m070.slice(m070.indexOf('create or replace function period_is_closed'), m070.indexOf('create or replace function replace_order_items'))
await db.exec(guards)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/100_period_reopen_admin.sql', 'utf8')
await db.exec(sql); await db.exec(sql)   // повторний запуск
await db.exec(`grant all on all tables in schema public to authenticated; grant usage on schema auth to authenticated;`)
const as = async (uid) => { await db.exec(`reset role; select set_config('test.uid', '${uid}', false); set role authenticated;`) }

await as(ACC)
ok('бухгалтер закриває вересень', !(await fail(`insert into period_closings (company_id, period_year, period_month, status) values ('${C1}', 2026, 9, 'closed')`)))
ok('у журналі — «закрито»', (await q(`select count(*)::int n from period_close_log where action = 'close'`)).rows[0].n === 1)
ok('запис у банк із датою закритого місяця — відмова (пряма вставка)', /PERIOD_CLOSED/.test(await fail(`insert into bank_transactions (company_id, date, amount) values ('${C1}', '2026-09-15', 100)`) || ''))
ok('документ у закритому місяці — відмова', /PERIOD_CLOSED/.test(await fail(`insert into documents (company_id, doc_date, amount) values ('${C1}', '2026-09-10', 5)`) || ''))
ok('рух складу в закритому місяці — відмова', /PERIOD_CLOSED/.test(await fail(`insert into stock_movements (company_id, date, quantity) values ('${C1}', '2026-09-03', 1)`) || ''))
ok('жовтень (відкритий) — можна', !(await fail(`insert into bank_transactions (company_id, date, amount) values ('${C1}', '2026-10-01', 100)`)))
ok('бухгалтер переоткриває — відмова', /PERIOD_REOPEN_ADMIN/.test(await fail(`update period_closings set status = 'reopened', reopen_reason = 'треба' where period_month = 9`) || ''))
ok('видалити закритий місяць — відмова', /PERIOD_CLOSED_DELETE/.test(await fail(`delete from period_closings where period_month = 9`) || ''))
await as(ADMIN)
ok('адмін без причини — відмова', /PERIOD_REOPEN_REASON/.test(await fail(`update period_closings set status = 'reopened' where period_month = 9`) || ''))
ok('адмін з причиною — можна', !(await fail(`update period_closings set status = 'reopened', reopen_reason = 'забули прихідну' where period_month = 9`)))
ok('у журналі — «переоткрито» з причиною', (await q(`select reason from period_close_log where action = 'reopen'`)).rows[0]?.reason === 'забули прихідну')
ok('після переоткриття запис у вересень — можна', !(await fail(`insert into bank_transactions (company_id, date, amount) values ('${C1}', '2026-09-15', 100)`)))
await as(ACC)
ok('повторне закриття — можна, у журналі друге «закрито»', !(await fail(`update period_closings set status = 'closed', closed_at = now() where period_month = 9`))
  && (await q(`select count(*)::int n from period_close_log where action = 'close'`)).rows[0].n === 2)
ok('писати в журнал напряму — відмова', !!(await fail(`insert into period_close_log (period_year, period_month, action) values (2026, 1, 'close')`)))
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
