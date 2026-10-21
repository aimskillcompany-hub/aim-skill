import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
await db.exec(`create table bank_transactions (id text primary key, amount numeric); create table documents (id text primary key, amount numeric);
  create table transaction_documents (id serial primary key, transaction_id text, document_id text, amount numeric, unique (transaction_id, document_id));
  insert into bank_transactions values ('t1', 1000), ('t2', -500); insert into documents values ('d1', 600), ('d2', 600), ('d3', null);
  insert into transaction_documents (transaction_id, document_id, amount) values ('t1','d1',600), ('t1','d2',600);`)   // старе задвоєння (1200 > 1000)
await db.exec(fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/089_link_amount_guard.sql', 'utf8'))
await db.exec(fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/089_link_amount_guard.sql', 'utf8'))
const err = async (s) => { try { await q(s); return null } catch (e) { return e.message } }
ok('нова прив\'язка до вже переповненого платежу — відмова', /OVERLINK: платіж/.test(await err(`insert into transaction_documents (transaction_id, document_id, amount) values ('t1','d3',1)`) || ''))
ok('прив\'язка понад суму документа — відмова', /OVERLINK: документ/.test(await err(`insert into transaction_documents (transaction_id, document_id, amount) values ('t2','d1',100)`) || ''))
ok('у межах сум — можна (від\'ємний платіж за модулем)', !(await err(`insert into transaction_documents (transaction_id, document_id, amount) values ('t2','d3',500)`)))
ok('зменшення задвоєної прив\'язки — можна', !(await err(`update transaction_documents set amount = 400 where transaction_id='t1' and document_id='d2'`)))
ok('збільшення понад — відмова', /OVERLINK/.test(await err(`update transaction_documents set amount = 700 where transaction_id='t1' and document_id='d2'`) || ''))
ok('видалення — можна', !(await err(`delete from transaction_documents where transaction_id='t1' and document_id='d2'`)))
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
