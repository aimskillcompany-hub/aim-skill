import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const U = (n) => 'aaaa0000-0000-0000-0000-00000000000' + n
await db.exec(`create role authenticated; create role anon; create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table profiles (id uuid primary key, role text, full_name text, created_at timestamptz default now());
  insert into profiles values ('${U(1)}', 'admin', 'Дмитро Редько', '2025-01-01'), ('${U(2)}', 'manager', 'Олена Коваль', '2025-02-01'), ('${U(3)}', 'manager', 'Андрій', '2025-03-01');
  create table tasks (id uuid default gen_random_uuid() primary key, title text not null, description text, due_date date, status text default 'open',
    priority text default 'normal', created_by uuid references profiles(id) on delete set null, source text default 'app', reminded_on date, done_at timestamptz,
    created_at timestamptz default now(), company_id uuid);`)
const M = '/Users/dmitroredko/claude-projects/aim-skill/migrations/'
await db.exec(fs.readFileSync(M + '092_tasks_planner_base.sql', 'utf8'))
const sql = fs.readFileSync(M + '093_tasks_notifications.sql', 'utf8')
const tx = sql.slice(0, sql.indexOf('\ncommit;') + 9)
await db.exec(tx); await db.exec(tx)
console.log('092 + 093 (двічі, без розкладу) застосовано')
const as = (u) => db.exec(`select set_config('test.uid', '${u || ''}', false)`)
const notif = async (u) => (await q(`select kind, title from notifications where user_id = $1 order by created_at, kind`, [u])).rows
await as(U(1))
const soon = new Date(Date.now() + 30 * 60e3).toISOString(), far = new Date(Date.now() + 3 * 864e5).toISOString()
const id = (await q(`insert into tasks (title, assignee_id, requires_review, due_at) values ('Звірити банк', '${U(2)}', true, '${far}') returning id`)).rows[0].id
ok('призначено → Олені «assigned», собі (Дмитру) — нічого', (await notif(U(2))).some(n => n.kind === 'assigned') && (await notif(U(1))).length === 0)
const rem = (await q(`select kind, user_id from task_reminders where task_id = $1 order by kind`, [id])).rows
console.log('    нагадування:', rem.map(r => r.kind + '→' + r.user_id.slice(-1)).join(', '))
ok('нагадування: за 1440 і 60 хв (Олені), у момент терміну (обом)', rem.filter(r => r.kind.startsWith('before:')).length === 2 && rem.filter(r => r.kind === 'due').length === 2)
await q(`update tasks set due_at = '${soon}' where id = $1`, [id])
const rem2 = (await q(`select kind from task_reminders where task_id = $1 and sent_at is null`, [id])).rows.map(r => r.kind)
ok('термін через 30 хв → «за 24 год» і «за 1 год» уже в минулому (не створено), лишився «у момент терміну»', !rem2.includes('before:1440') && !rem2.includes('before:60') && rem2.filter(k => k === 'due').length === 2)
await as(U(2))
await q(`insert into task_comments (task_id, body) values ($1, 'Почала. @Андрію глянь виписку')`, [id])
ok('коментар Олени: Дмитру «comment», Андрію «mention», Олені — нічого', (await notif(U(1))).some(n => n.kind === 'comment') && (await notif(U(3))).some(n => n.kind === 'mention') && !(await notif(U(2))).some(n => n.kind === 'comment'))
await q(`update tasks set status = 'review', result_text = 'Звірено' where id = $1`, [id])
ok('здано на перевірку → Дмитру «review»', (await notif(U(1))).some(n => n.kind === 'review'))
await as(U(1))
await q(`update tasks set status = 'in_progress' where id = $1`, [id])
ok('повернуто → Олені «returned»', (await notif(U(2))).some(n => n.kind === 'returned'))
await q(`select task_remind_me($1, now() + interval '1 second')`, [id])
await q(`update task_reminders set remind_at = now() - interval '1 minute' where task_id = $1 and kind in ('due', 'custom')`, [id])
await as(null)
const n1 = (await q(`select process_task_reminders() n`)).rows[0].n
ok(`обробка: ${n1} нагадувань → сповіщення «due» обом і «reminder» Дмитру; повторно — 0`, n1 >= 3 && (await notif(U(2))).some(n => n.kind === 'due') && (await notif(U(1))).some(n => n.kind === 'reminder')
  && (await q(`select count(*)::int c from task_reminders where task_id = $1 and sent_at is null and remind_at <= now()`, [id])).rows[0].c === 0)
await q(`update tasks set due_at = now() - interval '2 days' where id = $1`, [id])
const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }).format(new Date()))
await q(`select process_task_reminders()`)
const ov = (await q(`select count(*)::int c from notifications where task_id = $1 and kind = 'overdue'`, [id])).rows[0].c
ok(`прострочення: ${hour >= 9 ? 'після 09:00 — обом, раз на день' : 'до 09:00 — ще ні'} (${ov})`, hour >= 9 ? ov === 2 : ov === 0)
await q(`select process_task_reminders()`)
ok('прострочення не дублюється того ж дня', (await q(`select count(*)::int c from notifications where task_id = $1 and kind = 'overdue'`, [id])).rows[0].c === ov)
await as(U(2))
const code = (await q(`select telegram_link_code() c`)).rows[0].c
ok('код прив\'язки Telegram: 20 символів, лише у своєму профілі', code.length === 20 && (await q(`select telegram_link_code from profiles where id = '${U(2)}'`)).rows[0].telegram_link_code === code)
await q(`select set_notify_prefs('{"comment": false}')`)
ok('налаштування сповіщень збережено', (await q(`select notify_prefs from profiles where id = '${U(2)}'`)).rows[0].notify_prefs.comment === false)
await q(`update tasks set status = 'done', result_text = 'Ок' where id = $1`, [id]).catch(e => console.log('   ', e.message))
await as(U(1)); await q(`update tasks set status = 'done' where id = $1`, [id]).catch(() => {})
ok('після закриття незавершені нагадування прибрано', (await q(`select count(*)::int c from task_reminders where task_id = $1 and sent_at is null and kind <> 'custom'`, [id])).rows[0].c === 0)
const body = sql.replace(/--[^\n]*/g, '')
const st = body.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /\b(delete from|update \w+( \w+)? set|truncate)\b/i.test(s))
const bad = st.filter(s => /\btruncate\b/i.test(s) || !/\bwhere\b/i.test(s.slice(s.search(/\b(delete from|update)\b/i))))
ok(`093: без WHERE ${bad.length} (перевірено ${st.length})`, bad.length === 0)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
