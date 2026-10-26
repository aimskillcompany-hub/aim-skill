import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
await db.exec(`create table order_items (id serial primary key, name text, qty numeric); insert into order_items (name, qty) values ('плотер', 1)`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/105_item_ship_date.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
ok('наявна позиція — без дати', (await q('select ship_date from order_items')).rows[0].ship_date === null)
await q(`update order_items set ship_date = '2026-12-15'`)
ok('дату можна вписати', String((await q('select ship_date from order_items')).rows[0].ship_date).length > 0)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
