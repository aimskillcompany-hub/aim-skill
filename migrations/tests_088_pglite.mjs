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
await db.exec(`create table product_aliases (id uuid primary key default gen_random_uuid(), product_id uuid, alias text, normalized text unique, created_at timestamptz default now());
  create table transaction_items (id uuid primary key default gen_random_uuid(), product_id uuid);
  create table assemblies (id uuid primary key default gen_random_uuid(), name text, result_product_id uuid, quantity numeric, total_cost numeric, assembled_at date, company_id uuid default '${A}', created_at timestamptz default now());
  create table assembly_items (id uuid primary key default gen_random_uuid(), assembly_id uuid, product_id uuid, quantity numeric, cost_price numeric, total numeric);
  alter table generated_docs add column doc_number text;
  alter table stock_movements add column transaction_item_id uuid, add column total numeric, add column description text;
  alter table stock_movements add constraint fk_asm foreign key (assembly_id) references assemblies(id) on delete set null;
  alter table products add column unit text, add column current_stock numeric, add column is_verified boolean, add column created_at timestamptz default now(), add column company_id uuid default '${A}'`)
const M = '/Users/dmitroredko/claude-projects/aim-skill/migrations/'
for (const f of ['071_fifo_batches.sql', '072_batch_vat_basis.sql', '073_fifo_safe_compute.sql', '074_fifo_estimate_order_assembly.sql', '075_merge_products_fifo_apply.sql', '076_shipment_recon.sql', '077_doc_date_sync.sql', '078_recon_inbox.sql', '079_fifo_doc_date.sql', '080_batch_lock.sql', '081_doc_gen_sync.sql', '087_split_product.sql', '088_stock_excel_fixes.sql', '088_stock_excel_fixes.sql'])
  await db.exec(fs.readFileSync(M + f, 'utf8'))
console.log('071–081, 087, 088 (двічі) застосовано')
const as = (uid) => db.exec(`select set_config('test.uid', '${uid}', false)`)
await as(ADMIN)
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const one = async (s, p) => (await q(s, p)).rows[0]
const err = async (s) => { try { await q(s); return null } catch (x) { return x.message } }
const mv = async (p, doc, t, qty, price, date, extra = {}) => (await q(`insert into stock_movements (product_id, type, quantity, price, date, document_id, source, total, transaction_item_id) values ($1,$2,$3,$4,$5,$6,'document',$7,$8) returning id`,
  [p, t, qty, price, date, doc, extra.total ?? null, extra.ti ?? null])).rows[0].id
const doc = async (n, num, date, amount = null) => { await q(`insert into documents (id, doc_number, doc_date, amount, vat_amount) values ($1,$2,$3,$4,0)`, [id(n), num, date, amount]); return id(n) }
const prod = async (n, name, sku = null, unit = 'шт') => { await q(`insert into products (id, name, sku, product_type, unit) values ($1,$2,$3,'goods',$4)`, [id(n), name, sku, unit]); return id(n) }
const cost = async (m) => Number((await one(`select cost_price from stock_movements where id=$1`, [m])).cost_price)
const log = async (a) => (await one(`select id from cost_action_log where action=$1 order by created_at desc limit 1`, [a])).id

console.log('— 1. Картка: артикул / назва')
const UB = await prod(101, 'UltraBay 4 Portable Complete Set', 'W3534'), UBL = await prod(102, 'UltraBlock USB3 Kit')
await q(`select product_fix('${UB}', 'W5170')`)
ok('артикул W3534 → W5170', (await one(`select sku from products where id='${UB}'`)).sku === 'W5170')
await q(`select product_fix('${UBL}', 'W2420')`)
ok('порожній артикул заповнено', (await one(`select sku from products where id='${UBL}'`)).sku === 'W2420')
await q(`select stock_fix_undo('${await log('product_sku')}')`)
ok('скасування: артикул знову порожній', (await one(`select sku from products where id='${UBL}'`)).sku === null)
ok('повторне скасування — відмова', /вже скасовано/.test(await err(`select stock_fix_undo('${await log('product_sku')}')`) || ''))
ok('перейменування на зайняту назву — відмова', /NAME_TAKEN/.test(await err(`select product_fix('${UBL}', null, 'ultrabay 4 portable complete set ')`) || ''))
await q(`select product_fix('${UBL}', null, 'Digital Intelligence UltraBlock USB3 Kit', 'kit ultrablock usb3')`)
ok('перейменовано, стара назва — синонім', (await one(`select name from products where id='${UBL}'`)).name === 'Digital Intelligence UltraBlock USB3 Kit'
  && (await one(`select count(*)::int n from product_aliases where product_id='${UBL}' and alias='UltraBlock USB3 Kit'`)).n === 1)
await q(`select stock_fix_undo('${await log('product_rename')}')`)
ok('скасування: назва повернулась, синонім прибрано', (await one(`select name from products where id='${UBL}'`)).name === 'UltraBlock USB3 Kit'
  && (await one(`select count(*)::int n from product_aliases where product_id='${UBL}'`)).n === 0)

console.log('— 2. Часткове перенесення (сценарій 3)')
const NOVA = await prod(201, 'Корпус ATX без блока живлення', 'Nova N6'), BD = await prod(202, 'Корпус ATX GAMEMAX Black Diamond CP')
const dN = await doc(1, '40640722', '2025-04-17', 3390), dB = await doc(2, '40655173', '2025-05-29', 14508), dS = await doc(3, '3', '2025-06-06')
const inN = await mv(NOVA, dN, 'in', 3, 1130, '2025-04-17'), inB = await mv(BD, dB, 'in', 2, 1612, '2025-05-29')
const outS = await mv(NOVA, dS, 'out', 3, 2000, '2025-06-06', { total: 6000, ti: id(901) })
await q(`select allocate_out('${outS}')`)
ok('мінімальна кількість ≥ К-сть — відмова', /меншою за/.test(await err(`select split_movement('${outS}', 3, '${BD}')`) || ''))
ok('дробова для «шт» — відмова', /цілою/.test(await err(`select split_movement('${outS}', 1.5, '${BD}')`) || ''))
const r2 = (await one(`select split_movement('${outS}', 1, '${BD}') r`)).r
const st = async (p) => Number((await one(`select coalesce(sum(case when type='in' then quantity else -quantity end),0) s from stock_movements where product_id=$1`, [p])).s)
ok(`Nova N6: лишилось 2 у продажу, залишок ${await st(NOVA)}`, (await one(`select quantity from stock_movements where id='${outS}'`)).quantity == 2 && (await st(NOVA)) === 1)
const nm = await one(`select * from stock_movements where id='${r2.new_mov}'`)
ok(`Black Diamond: +1 видаток (той самий документ, ціна, без позиції документа), залишок ${await st(BD)}`, nm.product_id === BD && nm.document_id === dS && Number(nm.price) === 2000 && nm.transaction_item_id === null && Number(nm.total) === 2000 && (await st(BD)) === 1)
ok('оригінал зберіг позицію документа, сума 4000', (await one(`select transaction_item_id, total from stock_movements where id='${outS}'`)).transaction_item_id === id(901) && Number((await one(`select total from stock_movements where id='${outS}'`)).total) === 4000)
await q(`select stock_fix_undo('${r2.log_id}')`)
ok('скасування: один рух на 3 шт, копії немає, розподіл повернувся', (await one(`select quantity from stock_movements where id='${outS}'`)).quantity == 3
  && !(await one(`select id from stock_movements where id='${r2.new_mov}'`)) && (await one(`select count(*)::int n from stock_allocations where out_movement_id='${outS}'`)).n > 0)

console.log('— 3. Документи: дата, номер, порядок у дні (сценарії 4, 5)')
const NB = await prod(301, 'Ноутбук 18.5"')
const d2109 = await doc(11, '2109', '2026-10-09', 100000), dVN = await doc(12, 'ВН-0044', '2026-10-09'), dOther = await doc(13, 'ВН-0043', '2026-10-09')
const i2109 = await mv(NB, d2109, 'in', 5, 20000, '2026-10-09')
const oOther = await mv(NB, dOther, 'out', 5, 30000, '2026-10-09')
const o44 = await mv(NB, dVN, 'out', 2, 30000, '2026-10-09')
const fifo = async () => Object.fromEntries((await q(`select out_id, new_unit, missing_qty from fifo_compute('2026-01-01')`)).rows.map(r => [r.out_id, r]))
let fr = await fifo()
console.log(`    до: ВН-0043 ${fr[oOther].new_unit} (нестача ${fr[oOther].missing_qty}), ВН-0044 ${fr[o44].new_unit} (нестача ${fr[o44].missing_qty})`)
ok('до: ВН-0044 без собівартості (партію забрала ВН-0043)', Number(fr[o44].missing_qty) === 2)
await q(`select doc_fix('${d2109}', null, null, 1)`); await q(`select doc_fix('${dVN}', null, null, 2)`); await q(`select doc_fix('${dOther}', null, null, 3)`)
fr = await fifo()
ok(`після порядку 1/2/3: ВН-0044 отримує собівартість ${fr[o44].new_unit}, нестача в ВН-0043 ${fr[oOther].missing_qty}`, Number(fr[o44].missing_qty) === 0 && Number(fr[o44].new_unit) === 20000 && Number(fr[oOther].missing_qty) === 2)
await q(`select doc_fix('${d2109}', null, null, 5)`)
fr = await fifo()
ok('прихід із порядком 5 після видатків 2/3 — партія ще недоступна', Number(fr[o44].missing_qty) === 2)
await q(`select allocate_out('${o44}')`)
ok('allocate_out теж враховує порядок (нестача 2)', Number((await one(`select cost_missing_qty from stock_movements where id='${o44}'`)).cost_missing_qty) === 2)
// дата + номер + вирівнювання рухів
const d13 = await doc(14, '13', '2026-04-30'), d48 = await doc(15, '48', '2026-05-28', 100)
const UK = await prod(302, 'UltraKit v5'); const iUK = await mv(UK, d48, 'in', 1, 398000, '2026-05-28'); const oUK = await mv(UK, d13, 'out', 1, 500000, '2026-04-30')
fr = await fifo(); ok('№13 30.04 — видаток до приходу', Number(fr[oUK].missing_qty) === 1)
await q(`select doc_fix('${d13}', '2026-05-28', '13/1', 2)`); await q(`select doc_fix('${d48}', null, null, 1)`)
ok('дата документа й руху 28.05, номер змінено', (await one(`select doc_date::text d, doc_number n from documents where id='${d13}'`)).n === '13/1' && (await one(`select date::text d from stock_movements where id='${oUK}'`)).d === '2026-05-28')
fr = await fifo(); ok('№48 першим у дні — без нестачі', Number(fr[oUK].missing_qty) === 0)
await q(`select stock_fix_undo('${(await one(`select id from cost_action_log where action='doc_fix' and document_id='${d13}' order by created_at desc limit 1`)).id}')`)
ok('скасування: дата 30.04, номер 13, рух 30.04', (await one(`select doc_date::text d, doc_number n, day_order o from documents where id='${d13}'`)).n === '13'
  && (await one(`select date::text d from stock_movements where id='${oUK}'`)).d === '2026-04-30')
await db.exec(`insert into period_closings values ('${A}', 2026, 3, 'closed')`)
ok('нова дата в закритому місяці — відмова', /PERIOD_CLOSED/.test(await err(`select doc_fix('${d13}', '2026-03-15')`) || ''))

console.log('— 4. Збірки (сценарій 6)')
const KIT = await prod(401, 'Монтажний комплект ETI'), ETI = await prod(402, 'Щит пластиковий ETI ECH 24PT'), PFT = await prod(403, 'Розширювач PFT1300'), CAB = await prod(404, 'Кабель')
const dP = await doc(21, '678', '2026-08-31', 0)
await mv(ETI, dP, 'in', 2, 1326, '2026-08-31'); await mv(PFT, dP, 'in', 1, 300, '2026-08-31'); await mv(CAB, dP, 'in', 10, 100, '2026-08-31')
const ASM = id(501)
await q(`insert into assemblies (id, name, result_product_id, quantity, total_cost, assembled_at) values ('${ASM}', 'Монтажний комплект ETI', '${KIT}', 2, 0, '2026-09-10')`)
await q(`insert into assembly_items (id, assembly_id, product_id, quantity, cost_price, total) values ('${id(511)}','${ASM}','${PFT}',1,300,300), ('${id(512)}','${ASM}','${CAB}',10,100,1000)`)
await q(`insert into stock_movements (product_id, type, quantity, price, cost_price, date, source, assembly_id) values ('${PFT}','out',1,300,300,'2026-09-10','assembly','${ASM}'), ('${CAB}','out',10,100,100,'2026-09-10','assembly','${ASM}'), ('${KIT}','in',2,650,650,'2026-09-10','assembly','${ASM}')`)
const kitIn = (await one(`select id from stock_movements where assembly_id='${ASM}' and type='in'`)).id
const dSale = await doc(22, 'ВН-0031', '2026-09-15'); const oKit = await mv(KIT, dSale, 'out', 1, 5000, '2026-09-15')
const items = JSON.stringify([{ item_id: id(511), product_id: PFT, qty: 0 }, { item_id: id(512), product_id: CAB, qty: 10 }, { item_id: null, product_id: ETI, qty: 2 }])
const ra = (await one(`select assembly_fix('${ASM}', '2026-09-15', null, '${items}'::jsonb, 'keep', null) r`)).r
console.log('   ', JSON.stringify(ra))
ok(`Щит ETI: залишок ${await st(ETI)} (було 2)`, (await st(ETI)) === 0)
ok(`PFT1300 повернувся: залишок ${await st(PFT)}`, (await st(PFT)) === 1)
ok(`собівартість комплекту: було ${ra.old_unit} → стане ${ra.unit_cost} (= (1000 + 2×1326)/2 = 1826)`, Number(ra.unit_cost) === 1826)
ok('дата збірки і всіх рухів 15.09', (await one(`select count(*)::int n from stock_movements where assembly_id='${ASM}' and date <> '2026-09-15'`)).n === 0
  && (await one(`select assembled_at::text d from assemblies where id='${ASM}'`)).d === '2026-09-15')
ok('продаж ВН-0031 (розподіл з виробу) не зачеплено', (await one(`select count(*)::int n from stock_movements where id='${oKit}'`)).n === 1)
const rm = (await one(`select assembly_fix('${ASM}', null, null, null, 'set', 2000) r`)).r
ok('ручна собівартість 2000', Number(rm.unit_cost) === 2000 && Number((await one(`select cost_price from stock_movements where id='${kitIn}'`)).cost_price) === 2000)
fr = await fifo()
ok(`FIFO не перезаписує ручну собівартість виробу: продаж ВН-0031 = ${fr[oKit].new_unit}`, Number(fr[oKit].new_unit) === 2000)
await q(`select stock_fix_undo('${rm.log_id}')`); await q(`select stock_fix_undo('${ra.log_id}')`)
ok(`скасування обох: ETI ${await st(ETI)}, PFT ${await st(PFT)}, дата 10.09, компонентів 2`, (await st(ETI)) === 2 && (await st(PFT)) === 0
  && (await one(`select assembled_at::text d from assemblies where id='${ASM}'`)).d === '2026-09-10' && (await one(`select count(*)::int n from assembly_items where assembly_id='${ASM}'`)).n === 2)

console.log('— 5. Синоніми')
await q(`insert into product_aliases (id, product_id, alias, normalized) values ('${id(601)}','${UK}','UltraKit v5','a'), ('${id(602)}','${UK}','Комплект UltraKit v5 повний','b'), ('${id(603)}','${UK}','Комплект  UltraKit v5 повний','c')`)
ok('останній синонім = назва картки — відмова', /останній синонім/.test(await err(`select alias_delete(array['${id(601)}']::uuid[])`) || ''))
const rd = (await one(`select alias_delete(array['${id(603)}']::uuid[]) r`)).r
ok('дубль видалено', rd.deleted === 1 && (await one(`select count(*)::int n from product_aliases where product_id='${UK}'`)).n === 2)
await q(`select stock_fix_undo('${rd.log_id}')`)
ok('скасування: дубль повернувся', (await one(`select count(*)::int n from product_aliases where product_id='${UK}'`)).n === 3)

console.log('— права й SQL')
await as(MGR)
ok('менеджер: product_fix — відмова', /NO_RIGHTS|прав/i.test(await err(`select product_fix('${UB}', 'X')`) || ''))
ok('менеджер: doc_fix — відмова', /NO_RIGHTS|прав/i.test(await err(`select doc_fix('${d48}', null, null, 1)`) || ''))
await as(ADMIN)
const body = fs.readFileSync(M + '088_stock_excel_fixes.sql', 'utf8').replace(/--[^\n]*/g, '')
const stm = body.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /\b(delete from|update \w+( \w+)? set|truncate)\b/i.test(s))
const bad = stm.filter(s => /\btruncate\b/i.test(s) || !/\bwhere\b/i.test(s.slice(s.search(/\b(delete from|update)\b/i))))
ok(`088: без WHERE ${bad.length} (перевірено ${stm.length})`, bad.length === 0)
bad.forEach(s => console.log('     ', s.slice(0, 120)))
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
