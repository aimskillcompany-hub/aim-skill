import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
await db.exec(`create role authenticated; create role anon;
  create table generated_docs (id uuid primary key, parent_doc_id uuid references generated_docs(id));
  create table documents (id uuid primary key, doc_number text, generated_doc_id uuid, parent_doc_id uuid);
  create table stock_movements (id uuid primary key default gen_random_uuid(), document_id uuid references documents(id) on delete set null, source text, quantity numeric, type text);
  create table stock_allocations (id serial, out_movement_id uuid references stock_movements(id) on delete cascade, in_movement_id uuid references stock_movements(id) on delete cascade, qty numeric);
  create table transaction_documents (id serial, document_id uuid references documents(id) on delete cascade, amount numeric);
  create table shipment_links (id serial, out_document_id uuid references documents(id) on delete cascade, in_document_id uuid references documents(id) on delete cascade, removed_at timestamptz);
  create table manual_costs (id serial, out_document_id uuid references documents(id) on delete cascade, removed_at timestamptz);
  create table batch_locks (id serial, in_document_id uuid references documents(id) on delete cascade, removed_at timestamptz);
  create table recon_acks (id serial, out_document_id uuid references documents(id) on delete cascade, removed_at timestamptz);
  create table agent_commissions (document_id uuid primary key references documents(id) on delete cascade);
  grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated;
  alter table stock_movements enable row level security;
  create policy sel on stock_movements for select using (true);
  create policy ins on stock_movements for insert with check (true);
  create policy upd on stock_movements for update using (true);
  create policy del on stock_movements for delete using (current_setting('test.role', true) = 'admin');`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/086_delete_document_full.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
// прихідна P (з архівною версією G, у G є дочірній G2), продаж S з її партій, оплата, ручна прив'язка
await db.exec(`insert into generated_docs values ('${id(901)}', null), ('${id(902)}', '${id(901)}');
  insert into documents values ('${id(1)}','П-1','${id(901)}',null), ('${id(2)}','ВН-7',null,null), ('${id(3)}','Акт',null,'${id(901)}');
  insert into stock_movements (id, document_id, source, quantity, type) values ('${id(11)}','${id(1)}','document',5,'in'), ('${id(12)}','${id(2)}','document',3,'out'), ('${id(13)}','${id(1)}','assembly',1,'in');
  insert into stock_allocations (out_movement_id, in_movement_id, qty) values ('${id(12)}','${id(11)}',3);
  insert into transaction_documents (document_id, amount) values ('${id(1)}', -1000);
  insert into shipment_links (out_document_id, in_document_id) values ('${id(2)}','${id(1)}');
  insert into agent_commissions values ('${id(1)}');`)
await db.exec(`set role authenticated`)
const pv = (await q(`select delete_document_preview('${id(1)}') r`)).rows[0].r
console.log('    перегляд:', JSON.stringify(pv))
ok('перегляд: 1 рух, оплата 1000, продано 3 шт (ВН-7), ручна прив\'язка 1, комісія 1, дочірніх 1', pv.movements === 1 && pv.payments.amount == 1000 && pv.sold_from_batches.qty == 3 && pv.sold_from_batches.docs[0] === 'ВН-7' && pv.manual === 1 && pv.agent_commission === 1 && pv.children === 1)
// менеджер: правила ховають рухи
await db.exec(`select set_config('test.role', 'manager', false)`)
let e = null; try { await q(`select delete_document_full('${id(1)}')`) } catch (x) { e = x.message }
ok('менеджер: зрозуміла відмова, нічого не видалено (документ і рух на місці)', /NO_RIGHTS/.test(e || '')
  && (await q(`select count(*)::int n from documents where id='${id(1)}'`)).rows[0].n === 1 && (await q(`select count(*)::int n from stock_movements where id='${id(11)}'`)).rows[0].n === 1)
// адмін
await db.exec(`select set_config('test.role', 'admin', false)`)
await q(`select delete_document_full('${id(1)}')`)
ok('адмін: документ, його рух і архівна версія видалені; рух збірки лишився', (await q(`select count(*)::int n from documents where id='${id(1)}'`)).rows[0].n === 0
  && (await q(`select count(*)::int n from stock_movements where id='${id(11)}'`)).rows[0].n === 0 && (await q(`select count(*)::int n from stock_movements where id='${id(13)}'`)).rows[0].n === 1
  && (await q(`select count(*)::int n from generated_docs where id='${id(901)}'`)).rows[0].n === 0)
ok('дочірні: посилання обнулено (generated_docs і documents), без помилки FK', (await q(`select parent_doc_id from generated_docs where id='${id(902)}'`)).rows[0].parent_doc_id === null
  && (await q(`select parent_doc_id from documents where id='${id(3)}'`)).rows[0].parent_doc_id === null)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
