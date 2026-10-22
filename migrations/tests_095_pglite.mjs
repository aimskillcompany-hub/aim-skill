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
await db.exec(fs.readFileSync(M + '094_task_subtasks.sql', 'utf8'))
const sql = fs.readFileSync(M + '095_subtask_results.sql', 'utf8'); await db.exec(sql); await db.exec(sql)
await db.exec(`select set_config('test.uid', '${U(1)}', false)`)
const id = (await q(`insert into tasks (title) values ('Плотер') returning id`)).rows[0].id
const sub = (await q(`insert into task_checklist (task_id, text, assignee_id) values ($1, 'Додаткова угода', '${U(2)}') returning id`, [id])).rows[0].id
await db.exec(`select set_config('test.uid', '${U(2)}', false)`)
await q(`update task_checklist set result_text = 'Угоду підписано', done = true where id = $1`, [sub])
await q(`insert into task_files (task_id, subtask_id, storage_path, name, size) values ($1, $2, 'tasks/x/y/a.pdf', 'угода.pdf', 1000)`, [id, sub])
const r = (await q(`select result_by, result_at, done_by from task_checklist where id = $1`, [sub])).rows[0]
ok('результат: хто й коли, і позначено виконаною', r.result_by === U(2) && !!r.result_at && r.done_by === U(2))
ok('Дмитру — сповіщення про результат підзадачі', (await q(`select title from notifications where user_id = '${U(1)}'`)).rows.some(x => /результат підзадачі/.test(x.title)))
ok('історія: subtask_result', (await q(`select count(*)::int c from task_activity where task_id = $1 and action = 'subtask_result'`, [id])).rows[0].c === 1)
await db.exec(`select set_config('test.uid', '${U(1)}', false)`)
await q(`delete from task_checklist where id = $1`, [sub])
ok('видалення підзадачі прибирає її файли', (await q(`select count(*)::int c from task_files where subtask_id = $1`, [sub])).rows[0].c === 0)
await q(`delete from tasks where id = $1`, [id])
ok('видалення задачі — без помилок', (await q(`select count(*)::int c from task_files`)).rows[0].c === 0)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
