import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const U = (n) => 'aaaa0000-0000-0000-0000-00000000000' + n
await db.exec(`create role authenticated; create role anon; create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table profiles (id uuid primary key, role text, full_name text, created_at timestamptz default now());
  insert into profiles values ('${U(1)}', 'admin', 'Дмитро', '2025-01-01'), ('${U(2)}', 'manager', 'Олена', '2025-02-01');
  create table tasks (id uuid default gen_random_uuid() primary key, title text not null, description text, due_date date, status text default 'open',
    priority text default 'normal', created_by uuid references profiles(id) on delete set null, source text default 'app', reminded_on date, done_at timestamptz,
    created_at timestamptz default now(), company_id uuid);`)
const M = '/Users/dmitroredko/claude-projects/aim-skill/migrations/'
await db.exec(fs.readFileSync(M + '092_tasks_planner_base.sql', 'utf8'))
const s93 = fs.readFileSync(M + '093_tasks_notifications.sql', 'utf8'); await db.exec(s93.slice(0, s93.indexOf('\ncommit;') + 9))
const sql = fs.readFileSync(M + '094_task_subtasks.sql', 'utf8'); await db.exec(sql); await db.exec(sql)
await db.exec(`select set_config('test.uid', '${U(1)}', false)`)
const id = (await q(`insert into tasks (title) values ('Замовлення 1234: виконати') returning id`)).rows[0].id
await q(`insert into task_checklist (task_id, text, position) values ($1, 'Отримати рахунок', 0)`, [id])
const sub = (await q(`insert into task_checklist (task_id, text, position, assignee_id, due_date) values ($1, 'Оплатити постачальнику', 1, '${U(2)}', '2026-10-30') returning id`, [id])).rows[0].id
ok('Олені — сповіщення «доручив(ла) вам підзадачу»', (await q(`select title, body from notifications where user_id = '${U(2)}'`)).rows.some(r => /підзадачу/.test(r.title) && /Оплатити/.test(r.body)))
await db.exec(`select set_config('test.uid', '${U(2)}', false)`)
await q(`update task_checklist set done = true where id = $1`, [sub])
const r = (await q(`select done, done_by, done_at from task_checklist where id = $1`, [sub])).rows[0]
ok('позначено виконаним: хто і коли', r.done && r.done_by === U(2) && !!r.done_at)
await q(`update task_checklist set done = false where id = $1`, [sub])
ok('зняття позначки очищає «хто / коли»', (await q(`select done_by from task_checklist where id = $1`, [sub])).rows[0].done_by === null)
await q(`delete from task_checklist where id = $1`, [sub])
const acts = (await q(`select action from task_activity where task_id = $1 order by id`, [id])).rows.map(x => x.action)
console.log('    історія:', acts.join(', '))
ok('історія: додано ×2, виконано, знято, видалено', acts.filter(a => a === 'subtask_add').length === 2 && acts.filter(a => a === 'subtask_done').length === 2 && acts.includes('subtask_del'))
let e = null; try { await q(`insert into task_checklist (task_id, text) values ($1, '')`, [id]) } catch (x) { e = x.message }
ok('порожній текст — відмова', /check/.test(e || ''))
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
await db.exec(`select set_config('test.uid', '${U(1)}', false)`)
let e2 = null; try { await q(`delete from tasks where id = $1`, [id]) } catch (x) { e2 = x.message }
ok('видалення задачі з підзадачами — без помилки: ' + (e2 || ''), !e2 && (await q(`select count(*)::int c from task_checklist where task_id = $1`, [id])).rows[0].c === 0)
