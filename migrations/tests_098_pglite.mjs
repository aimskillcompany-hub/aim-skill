import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001', ACC = 'aaaaaaaa-0000-0000-0000-000000000002'
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role authenticated;
  create table profiles (id uuid primary key, role text);
  create table meeting_minutes (id uuid default gen_random_uuid() primary key, title text);
  create table contractors (id uuid default gen_random_uuid() primary key, name text);
  create table accounts (id uuid default gen_random_uuid() primary key, name text);
  create table bank_transactions (id uuid default gen_random_uuid() primary key, amount numeric);
  create function is_admin() returns boolean language sql security definer stable as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;
  insert into profiles values ('${ADMIN}', 'admin'), ('${ACC}', 'accountant');
  insert into meeting_minutes (id, title) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Нарада 16.10');
  insert into bank_transactions (id, amount) values ('cccccccc-0000-0000-0000-000000000001', -50000);
  grant all on all tables in schema public to authenticated; grant usage on schema auth to authenticated;
`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/098_meeting_decisions.sql', 'utf8')
await db.exec(sql); await db.exec(sql)   // повторний запуск
await db.exec(`grant all on meeting_decisions to authenticated`)
const as = async (uid) => { await db.exec(`reset role; select set_config('test.uid', '${uid}', false); set role authenticated;`) }
const P = 'bbbbbbbb-0000-0000-0000-000000000001'
await as(ADMIN)
ok('адмін додає рішення', !(await fail(`insert into meeting_decisions (protocol_id, category, recipient, amount) values ($1, 'agent_fee', 'Агент', 50000)`, [P])))
ok('без одержувача — відмова', !!(await fail(`insert into meeting_decisions (protocol_id, category, amount) values ($1, 'other', 10)`, [P])))
ok('сума ≤ 0 — відмова', !!(await fail(`insert into meeting_decisions (protocol_id, category, recipient, amount) values ($1, 'other', 'x', 0)`, [P])))
ok('невідома категорія — відмова', !!(await fail(`insert into meeting_decisions (protocol_id, category, recipient, amount) values ($1, 'bonus', 'x', 5)`, [P])))
ok('платіж без статусу «сплачено» — відмова', !!(await fail(`update meeting_decisions set paid_transaction_id = 'cccccccc-0000-0000-0000-000000000001' where recipient = 'Агент'`)))
ok('платіж + «сплачено» — можна', !(await fail(`update meeting_decisions set paid_transaction_id = 'cccccccc-0000-0000-0000-000000000001', status = 'paid' where recipient = 'Агент'`)))
ok('той самий платіж до другого рішення — відмова', !!(await fail(`insert into meeting_decisions (protocol_id, category, recipient, amount, status, paid_transaction_id) values ($1, 'other', 'y', 5, 'paid', 'cccccccc-0000-0000-0000-000000000001')`, [P])))
await as(ACC)
ok('бухгалтер не бачить рішень', (await q(`select count(*)::int n from meeting_decisions`)).rows[0].n === 0)
ok('бухгалтер не може додати', !!(await fail(`insert into meeting_decisions (protocol_id, category, recipient, amount) values ($1, 'other', 'z', 5)`, [P])))
await as(ADMIN)
ok('адмін бачить своє', (await q(`select count(*)::int n from meeting_decisions`)).rows[0].n === 1)
await db.exec(`reset role; delete from meeting_minutes where id = '${P}'`)
ok('видалення протоколу видаляє його рішення', (await q(`select count(*)::int n from meeting_decisions`)).rows[0].n === 0)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
