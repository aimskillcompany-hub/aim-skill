import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
const O = '11111111-0000-0000-0000-000000000001', S = '22222222-0000-0000-0000-000000000001'
await db.exec(`
  create table contractors (id uuid primary key); create table orders (id uuid primary key);
  create table order_items (id uuid default gen_random_uuid() primary key, order_id uuid references orders(id) on delete cascade, qty numeric);
  create table order_payment_plan (id uuid default gen_random_uuid() primary key, order_id uuid not null references orders(id) on delete cascade,
    kind text not null, supplier_id uuid references contractors(id) on delete cascade, plan_date date, days integer, created_at timestamptz default now());
  insert into orders values ('${O}'); insert into contractors values ('${S}');
  insert into order_items (order_id, qty) values ('${O}', 5);
  insert into order_payment_plan (order_id, kind, supplier_id, plan_date) values ('${O}', 'supplier', '${S}', '2026-11-10');
`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/103_supplier_pay_terms.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
const old = (await q(`select part_no, share_pct, base_date, is_manual, plan_date from order_payment_plan`)).rows[0]
ok('наявний рядок: одна частина, уся сума, не вручну, дата лишилась', old.part_no === 1 && old.share_pct === null && old.base_date === null && old.is_manual === false && !!old.plan_date)
ok('дві частини 50% / 50% з днями −5 і 30', !(await fail(`insert into order_payment_plan (order_id, kind, supplier_id, part_no, share_pct, days) values ('${O}','supplier','${S}',1,50,-5), ('${O}','supplier','${S}',2,50,30)`)))
ok('дата отримання й ручна дата', !(await fail(`insert into order_payment_plan (order_id, kind, supplier_id, base_date, plan_date, is_manual) values ('${O}','supplier','${S}','2026-11-01','2026-11-20', true)`)))
ok('частка 0% — відмова', !!(await fail(`insert into order_payment_plan (order_id, kind, share_pct) values ('${O}','supplier', 0)`)))
ok('частка 120% — відмова', !!(await fail(`insert into order_payment_plan (order_id, kind, share_pct) values ('${O}','supplier', 120)`)))
ok('днів 1000 — відмова', !!(await fail(`insert into order_payment_plan (order_id, kind, days) values ('${O}','supplier', 1000)`)))
ok('відстрочка позиції', !(await fail(`update order_items set pay_days = 45`)))
ok('відстрочка позиції 999 — відмова', !!(await fail(`update order_items set pay_days = 999`)))
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
