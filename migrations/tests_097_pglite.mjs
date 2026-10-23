import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
await db.exec(`create table documents (id uuid default gen_random_uuid() primary key, type text, doc_number text, doc_date date,
  company_id uuid, amount numeric, created_at timestamptz default now());`)
const C1 = '11111111-0000-0000-0000-000000000001', C2 = '11111111-0000-0000-0000-000000000002'
// наявні дублі (до міграції) — лишаються
await db.exec(`insert into documents (type, doc_number, doc_date, company_id, amount) values
  ('waybill', 'ВН-0038', '2026-10-01', '${C1}', 100), ('waybill', 'ВН-0038', '2026-09-30', '${C1}', 200);`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/097_doc_number_unique.sql', 'utf8')
await db.exec(sql); await db.exec(sql)   // повторний запуск
ok('новий дубль у тій самій юрособі, типі й році — відмова',
  /DOC_NUMBER_TAKEN/.test(await fail(`insert into documents (type, doc_number, doc_date, company_id) values ('waybill', ' вн-0038 ', '2026-11-02', '${C1}')`) || ''))
ok('той самий номер в іншому році — можна', !(await fail(`insert into documents (type, doc_number, doc_date, company_id) values ('waybill', 'ВН-0038', '2025-05-01', '${C1}')`)))
ok('той самий номер в іншій юрособі — можна', !(await fail(`insert into documents (type, doc_number, doc_date, company_id) values ('waybill', 'ВН-0038', '2026-11-02', '${C2}')`)))
ok('той самий номер іншого типу (рахунок) — можна', !(await fail(`insert into documents (type, doc_number, doc_date, company_id) values ('invoice', 'ВН-0038', '2026-11-02', '${C1}')`)))
ok('прихідна з номером постачальника — не перевіряється', !(await fail(`insert into documents (type, doc_number, doc_date, company_id) values ('incomingWaybill', '2185', '2026-10-21', '${C1}'), ('incomingWaybill', '2185', '2026-10-22', '${C1}')`)))
const old = (await q(`select id from documents where type = 'waybill' and amount = 200`)).rows[0].id
ok('наявний дубль: правка суми не блокується', !(await fail(`update documents set amount = 250 where id = $1`, [old])))
ok('зміна номера на вільний — можна', !(await fail(`update documents set doc_number = 'ВН-0038-1' where id = $1`, [old])))
ok('зміна номера назад на зайнятий — відмова', /DOC_NUMBER_TAKEN/.test(await fail(`update documents set doc_number = 'ВН-0038' where id = $1`, [old]) || ''))
ok('без номера — без перевірки', !(await fail(`insert into documents (type, doc_number, company_id) values ('waybill', null, '${C1}'), ('waybill', '', '${C1}')`)))
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
