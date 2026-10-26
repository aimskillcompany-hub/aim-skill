import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
await db.exec(`create table profiles (id uuid primary key); create table orders (id serial primary key);
  create table order_transactions (id serial primary key, order_id int, amount numeric);
  insert into orders default values; insert into order_transactions (order_id, amount) values (1, 300000)`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/106_payment_confirmed.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
ok('наявна прив’язка — не підтверджена', (await q('select confirmed_at from order_transactions')).rows[0].confirmed_at === null)
await q('update order_transactions set confirmed_at = now()')
await q('update orders set paid_confirmed_at = now()')
ok('позначки ставляться', (await q('select count(*)::int n from order_transactions where confirmed_at is not null')).rows[0].n === 1 && (await q('select count(*)::int n from orders where paid_confirmed_at is not null')).rows[0].n === 1)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
