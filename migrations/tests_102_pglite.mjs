import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
await db.exec(`
  create table contractors (id uuid primary key); create table bank_transactions (id uuid primary key); create table orders (id uuid primary key);
  create table order_expenses (id uuid default gen_random_uuid() primary key, order_id uuid references orders(id) on delete cascade, name text, amount numeric not null default 0, created_at timestamptz default now());
  insert into orders values ('11111111-0000-0000-0000-000000000001');
  insert into order_expenses (order_id, name, amount) values ('11111111-0000-0000-0000-000000000001', 'Доставка', 4500);
  insert into contractors values ('22222222-0000-0000-0000-000000000001'); insert into bank_transactions values ('33333333-0000-0000-0000-000000000001');
`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/102_order_expenses_details.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
const old = (await q(`select kind, vat_included, contractor_id, expense_date, transaction_id from order_expenses`)).rows[0]
ok('наявна витрата: нові поля порожні, сума без ПДВ', old.kind === null && old.vat_included === false && old.contractor_id === null && old.transaction_id === null)
ok('нова витрата з усіма полями', !(await fail(`insert into order_expenses (order_id, name, amount, kind, vat_included, contractor_id, expense_date, transaction_id) values ('11111111-0000-0000-0000-000000000001', 'Комісія', 120, 'bank_fee', true, '22222222-0000-0000-0000-000000000001', '2026-10-20', '33333333-0000-0000-0000-000000000001')`)))
ok('невідомий тип — відмова', !!(await fail(`insert into order_expenses (order_id, amount, kind) values ('11111111-0000-0000-0000-000000000001', 5, 'bonus')`)))
await q(`delete from bank_transactions where id = '33333333-0000-0000-0000-000000000001'`)
ok('видалення транзакції лише знімає прив\'язку', (await q(`select count(*)::int n from order_expenses where kind = 'bank_fee' and transaction_id is null`)).rows[0].n === 1)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
