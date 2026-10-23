import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role authenticated;
  create table profiles (id uuid primary key); create table companies (id uuid primary key);
  create table orders (id uuid default gen_random_uuid() primary key, in_forecast boolean);
  insert into orders (id) values ('11111111-0000-0000-0000-000000000001'), ('11111111-0000-0000-0000-000000000002');
`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/099_forecast_snapshots.sql', 'utf8')
await db.exec(sql); await db.exec(sql)   // повторний запуск
const O = '11111111-0000-0000-0000-000000000001'
ok('знімок створюється', !(await fail(`insert into forecast_snapshots (order_id, revenue_net, costs, profit) values ($1, 1000, '{"purchase":700}', 200)`, [O])))
ok('другий поточний знімок того самого замовлення — відмова', !!(await fail(`insert into forecast_snapshots (order_id, revenue_net) values ($1, 5)`, [O])))
ok('змінити цифри знімка — відмова', /SNAPSHOT_IMMUTABLE/.test(await fail(`update forecast_snapshots set profit = 999 where order_id = $1`, [O]) || ''))
ok('змінити графік — відмова', /SNAPSHOT_IMMUTABLE/.test(await fail(`update forecast_snapshots set schedule = '[{"amount":1}]' where order_id = $1`, [O]) || ''))
ok('перевести в історію — можна', !(await fail(`update forecast_snapshots set is_current = false where order_id = $1`, [O])))
ok('superseded_at ставиться сам', (await q(`select superseded_at from forecast_snapshots where order_id = $1`, [O])).rows[0].superseded_at != null)
ok('повернути історичний у поточні — відмова', /SNAPSHOT_IMMUTABLE/.test(await fail(`update forecast_snapshots set is_current = true where order_id = $1`, [O]) || ''))
ok('новий знімок після зняття позначки — можна, старий лишається', !(await fail(`insert into forecast_snapshots (order_id, revenue_net, profit) values ($1, 1200, 250)`, [O]))
  && (await q(`select count(*)::int n from forecast_snapshots where order_id = $1`, [O])).rows[0].n === 2)
ok('видалити знімок — відмова', /SNAPSHOT_IMMUTABLE/.test(await fail(`delete from forecast_snapshots where order_id = $1`, [O]) || ''))
ok('видалення замовлення прибирає його знімки', !(await fail(`delete from orders where id = $1`, [O])) && (await q(`select count(*)::int n from forecast_snapshots`)).rows[0].n === 0)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
