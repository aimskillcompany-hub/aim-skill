import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0
const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const A = '00000000-0000-0000-0000-000000000001'
const ADMIN = 'aaaa0000-0000-0000-0000-000000000001', MGR = 'aaaa0000-0000-0000-0000-000000000002'
await db.exec(`create role authenticated; create role anon; create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table profiles (id uuid primary key, role text); insert into profiles values ('${ADMIN}', 'admin'), ('${MGR}', 'manager');
  create table companies (id uuid primary key, is_vat_payer boolean); insert into companies values ('${A}', true);
  create table products (id uuid primary key, name text, sku text, product_type text, buy_price numeric, status text default 'active');
  create table generated_docs (id uuid primary key, doc_date date);
  create table documents (id uuid primary key, generated_doc_id uuid, type text, order_id uuid, amount numeric, vat_amount numeric, doc_date date, doc_number text, created_at timestamptz default now(), company_id uuid default '${A}');
  create table supplier_orders (id uuid primary key, order_id uuid);
  create table order_items (id uuid primary key default gen_random_uuid(), order_id uuid, product_id uuid);
  create table period_closings (company_id uuid, period_year int, period_month int, status text);
  create table stock_movements (id uuid primary key default gen_random_uuid(), product_id uuid, type text, quantity numeric, price numeric, cost_price numeric,
    document_id uuid, order_id uuid, supplier_order_id uuid, assembly_id uuid, date date, created_at timestamptz default clock_timestamp(), company_id uuid default '${A}', source text);
  create or replace function period_is_closed(p_company uuid, d date) returns boolean language sql stable as $$
    select d is not null and exists (select 1 from period_closings pc where pc.status='closed' and pc.company_id = p_company
      and pc.period_year = extract(year from d)::int and pc.period_month = extract(month from d)::int) $$;
  create or replace function guard() returns trigger as $$ begin
    if (tg_op <> 'INSERT' and period_is_closed(old.company_id, old.date)) or (tg_op <> 'DELETE' and period_is_closed(new.company_id, new.date)) then raise exception 'PERIOD_CLOSED'; end if;
    return case when tg_op='DELETE' then old else new end; end $$ language plpgsql;
  create trigger g before insert or update or delete on stock_movements for each row execute function guard();`)
await db.exec(`create table product_aliases (id uuid primary key default gen_random_uuid(), product_id uuid, alias text, normalized text unique);
  create table transaction_items (id uuid primary key default gen_random_uuid(), product_id uuid);
  alter table stock_movements add column transaction_item_id uuid; alter table products add column unit text, add column current_stock numeric, add column is_verified boolean, add column created_at timestamptz default now()`)
const M = '/Users/dmitroredko/claude-projects/aim-skill/migrations/'
for (const f of ['071_fifo_batches.sql', '072_batch_vat_basis.sql', '073_fifo_safe_compute.sql', '074_fifo_estimate_order_assembly.sql', '075_merge_products_fifo_apply.sql', '076_shipment_recon.sql', '077_doc_date_sync.sql', '078_recon_inbox.sql', '079_fifo_doc_date.sql', '080_batch_lock.sql', '087_split_product.sql', '087_split_product.sql'])
  await db.exec(fs.readFileSync(M + f, 'utf8'))
console.log('071–080, 087 (двічі) застосовано')
const as = (uid) => db.exec(`select set_config('test.uid', '${uid}', false)`)
await as(ADMIN)
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const P = id(101), P2 = id(102)
await db.exec(`insert into products (id, name, sku, product_type, unit) values ('${P}','Відеоплата ASUS GT1030','8473','goods','шт'), ('${P2}','Інша','X','goods','шт');
  insert into documents (id, doc_number, doc_date, amount, vat_amount) values ('${id(1)}','A','2026-07-01',1000,0), ('${id(2)}','B','2026-08-01',2000,0), ('${id(11)}','ВН-1','2026-08-10',null,null);
  insert into transaction_items (id, product_id) values ('${id(201)}','${P}');
  insert into product_aliases (product_id, alias, normalized) values ('${P}','Відеоплата MSI GT1030 4Gb','msi'), ('${P}','Відеоплата ASUS GT1030','asus');`)
const mv = async (doc, t, qty, price, date, ti = null) => (await q(`insert into stock_movements (product_id, type, quantity, price, date, document_id, source, transaction_item_id) values ('${P}',$1,$2,$3,$4,$5,'document',$6) returning id`, [t, qty, price, date, doc, ti])).rows[0].id
const iA = await mv(id(1), 'in', 10, 100, '2026-07-01'), iB = await mv(id(2), 'in', 1, 400, '2026-08-01', id(201))
const o1 = await mv(id(11), 'out', 11, 900, '2026-08-10')
await q(`select allocate_out('${o1}')`)
const allocs = async () => (await q(`select count(*)::int n from stock_allocations`)).rows[0].n
const a0 = await allocs()
const cost0 = (await q(`select cost_price from stock_movements where id='${o1}'`)).rows[0].cost_price
await as(MGR)
let e = null; try { await q(`select split_product('${P}', array['${iB}']::uuid[], null, 'MSI GT1030 4Gb', null, array['Відеоплата MSI GT1030 4Gb'])`) } catch (x) { e = x.message }
ok('менеджер не може розділити', /NO_RIGHTS|прав/i.test(e || ''))
await as(ADMIN)
e = null; try { await q(`select split_product('${P}', array['${id(999)}']::uuid[], null, 'X')`) } catch (x) { e = x.message }
ok('чужий рух — відмова', /не належать/.test(e || ''))
e = null; try { await q(`select split_product('${P}', array['${iB}']::uuid[], null, '  ')`) } catch (x) { e = x.message }
ok('без назви нової картки — відмова', /назву/.test(e || ''))
const r = (await q(`select split_product('${P}', array['${iB}']::uuid[], null, 'Відеоплата MSI GT1030 4Gb', 'MSI-4G', array['Відеоплата MSI GT1030 4Gb']) r`)).rows[0].r
const T = r.target
const np = (await q(`select name, sku, unit, status from products where id='${T}'`)).rows[0]
ok(`нова картка: ${np.name} / ${np.sku} / ${np.unit}`, np.name === 'Відеоплата MSI GT1030 4Gb' && np.sku === 'MSI-4G' && np.unit === 'шт' && np.status === 'active')
ok('рух перенесено', (await q(`select product_id from stock_movements where id='${iB}'`)).rows[0].product_id === T)
ok('інші рухи лишились', (await q(`select count(*)::int n from stock_movements where product_id='${P}'`)).rows[0].n === 2)
ok('позиція документа перенесена', (await q(`select product_id from transaction_items where id='${id(201)}'`)).rows[0].product_id === T)
ok('синонім MSI перенесено, ASUS лишився', (await q(`select count(*)::int n from product_aliases where product_id='${T}'`)).rows[0].n === 1
  && (await q(`select count(*)::int n from product_aliases where product_id='${P}'`)).rows[0].n === 1)
ok(`розподіл між різними товарами видалено: ${r.allocations_removed}`, r.allocations_removed === 1 && (await allocs()) === a0 - 1)
ok('собівартість не змінена', (await q(`select cost_price from stock_movements where id='${o1}'`)).rows[0].cost_price == cost0)
// синонім без рухів — на наявну картку
const r2 = (await q(`select split_product('${P}', '{}'::uuid[], '${P2}', null, null, array['Відеоплата ASUS GT1030']) r`)).rows[0].r
ok('лише синонім на наявну картку', r2.aliases === 1 && r2.movements === 0)
await q(`select split_undo('${r2.log_id}')`)
// скасування
await q(`select split_undo('${r.log_id}')`)
ok('скасування: рух повернувся', (await q(`select product_id from stock_movements where id='${iB}'`)).rows[0].product_id === P)
ok('скасування: розподіл відновлено', (await allocs()) === a0)
ok('скасування: синоніми повернулись', (await q(`select count(*)::int n from product_aliases where product_id='${P}'`)).rows[0].n === 2)
ok('скасування: нова картка в архіві', (await q(`select status from products where id='${T}'`)).rows[0].status === 'archived')
e = null; try { await q(`select split_undo('${r.log_id}')`) } catch (x) { e = x.message }
ok('повторне скасування — відмова', /вже скасовано/.test(e || ''))
// прив'язка / закритий місяць
const lk = (await q(`select batch_lock('${iA}') r`)).rows[0].r
e = null; try { await q(`select split_product('${P}', array['${iA}']::uuid[], null, 'X')`) } catch (x) { e = x.message }
ok('закрита партія / прив\'язка — відмова: ' + (e || '').slice(0, 40), /LOCKED|LINKED/.test(e || ''))
await q(`select batch_unlock('${lk.id}')`)
await db.exec(`insert into period_closings values ('${A}', 2026, 8, 'closed')`)
e = null; try { await q(`select split_product('${P}', array['${iB}']::uuid[], null, 'X')`) } catch (x) { e = x.message }
ok('закритий місяць — відмова', /PERIOD_CLOSED/.test(e || ''))
const body = fs.readFileSync(M + '087_split_product.sql', 'utf8').replace(/--[^\n]*/g, '')
const st = body.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /\b(delete from|update \w+( \w+)? set|truncate)\b/i.test(s))
const bad = st.filter(s => /\btruncate\b/i.test(s) || !/\bwhere\b/i.test(s.slice(s.search(/\b(delete from|update)\b/i))))
ok(`087: без WHERE ${bad.length} (перевірено ${st.length})`, bad.length === 0)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
