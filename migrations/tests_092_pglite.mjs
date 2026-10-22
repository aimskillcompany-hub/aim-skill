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
    created_at timestamptz default now(), company_id uuid);
  insert into tasks (title, status, created_by, due_date) values ('Стара активна', 'open', '${U(2)}', '2026-10-20'), ('Стара виконана', 'done', '${U(1)}', null), ('З бота', 'open', null, null);
  insert into tasks (title, status, created_by, source, description) values ('Звірка: маржа', 'open', '${U(1)}', 'recon', 'Розібратись\n\nЗвірка: /inventory/recon?line=abc');`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/092_tasks_planner_base.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
const t = async (title) => (await q(`select * from tasks where title = $1`, [title])).rows[0]
const a = await t('Стара активна')
ok('стара активна → «Нова», відповідальний = автор, термін 18:00 Київ', a.status === 'new' && a.assignee_id === U(2) && a.due_at && new Date(a.due_at).toISOString() === '2026-10-20T15:00:00.000Z')
ok('стара виконана → «Виконано», completed_at', (await t('Стара виконана')).status === 'done' && !!(await t('Стара виконана')).completed_at)
ok('з бота (без автора) → відповідальний = перший адміністратор', (await t('З бота')).assignee_id === U(1))
ok('зі звірки → entity_type reconciliation, посилання', (await t('Звірка: маржа')).entity_type === 'reconciliation' && (await t('Звірка: маржа')).entity_ref === '/inventory/recon?line=abc')
const err = async (s, p) => { try { await q(s, p); return null } catch (e) { return e.message } }
await db.exec(`select set_config('test.uid', '${U(1)}', false)`)
const id = (await q(`insert into tasks (title, assignee_id, requires_review, due_at) values ('Нова', '${U(2)}', true, '2026-10-25T09:30:00Z') returning id`)).rows[0].id
const n = await t('Нова')
ok('нова: автор = поточний, статус «Нова», due_date з due_at, автор у спостерігачах', n.created_by === U(1) && n.status === 'new' && String(n.due_date).includes('2026') && (await q(`select count(*)::int c from task_watchers where task_id=$1 and user_id=$2`, [id, U(1)])).rows[0].c === 1)
await db.exec(`select set_config('test.uid', '${U(2)}', false)`)
await q(`update tasks set status = 'in_progress' where id = $1`, [id])
ok('без результату «На перевірці» — відмова', /RESULT_REQUIRED/.test(await err(`update tasks set status = 'review' where id = $1`, [id]) || ''))
await q(`update tasks set status = 'review', result_text = 'Зроблено', result_type = 'full' where id = $1`, [id])
ok('з результатом — «На перевірці», результат записано з автором', (await t('Нова')).status === 'review' && (await t('Нова')).result_by === U(2))
ok('відповідальний не може прийняти задачу з перевіркою', /REVIEW_REQUIRED/.test(await err(`update tasks set status = 'done' where id = $1`, [id]) || ''))
await db.exec(`select set_config('test.uid', '${U(1)}', false)`)
await q(`update tasks set status = 'done' where id = $1`, [id])
ok('постановник приймає → «Виконано», completed_at і старе done_at', (await t('Нова')).status === 'done' && !!(await t('Нова')).completed_at && !!(await t('Нова')).done_at)
await q(`update tasks set due_date = '2026-11-01' where id = $1`, [id])
ok('зміна due_date (бот) → due_at 18:00', new Date((await t('Нова')).due_at).toISOString() === '2026-11-01T16:00:00.000Z')
const acts = (await q(`select action from task_activity where task_id = $1 order by id`, [id])).rows.map(r => r.action)
console.log('    історія:', acts.join(', '))
ok('історія: created, status×3, result, due', acts[0] === 'created' && acts.filter(x => x === 'status').length === 3 && acts.includes('result') && acts.includes('due'))
ok('невідомий статус — відмова', /check/.test(await err(`update tasks set status = 'open' where id = $1`, [id]) || ''))
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
