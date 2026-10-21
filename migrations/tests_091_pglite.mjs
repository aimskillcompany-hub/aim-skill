import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s) => db.query(s)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
await db.exec(`create table orders (id uuid primary key); create table documents (id uuid primary key, is_verified boolean);
  create table products (id uuid primary key, name text, is_verified boolean);
  create table stock_movements (id serial primary key, product_id uuid, company_id uuid, type text, quantity numeric, is_verified boolean);
  create table bank_transactions (id serial primary key, amount numeric, is_validated boolean, is_verified boolean);
  create view product_stock as select p.*, s.stock from products p left join (select product_id, sum(quantity) stock from stock_movements group by 1) s on s.product_id = p.id;
  create table emails (id serial primary key, order_id uuid references orders(id)); create table mail_log (id serial, document_id uuid references documents(id));
  create table processed_emails (id serial); create table order_documents (id serial, order_id uuid, document_id uuid);`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/091_drop_mail_and_dead_flags.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
const has = async (t) => !!(await q(`select to_regclass('public.${t}') r`)).rows[0].r
const col = async (t, c) => (await q(`select count(*)::int n from information_schema.columns where table_name='${t}' and column_name='${c}'`)).rows[0].n === 1
ok('emails, mail_log, processed_emails, порожня order_documents — видалено', !(await has('emails')) && !(await has('mail_log')) && !(await has('processed_emails')) && !(await has('order_documents')))
ok('bank_transactions.is_verified і stock_movements.is_verified — видалено, is_validated лишилось', !(await col('bank_transactions', 'is_verified')) && !(await col('stock_movements', 'is_verified')) && (await col('bank_transactions', 'is_validated')))
ok('documents.is_verified, products.is_verified і в\'юха product_stock — на місці', (await col('documents', 'is_verified')) && (await col('products', 'is_verified')) && (await has('product_stock')))
const db2 = new PGlite()
await db2.exec(`create table orders (id uuid primary key); create table documents (id uuid primary key); create table bank_transactions (id serial); create table stock_movements (id serial);
  create table order_documents (id serial, order_id uuid); insert into order_documents (order_id) values (null);`)
await db2.exec(sql)
ok('непорожня order_documents — лишається', !!(await db2.query(`select to_regclass('public.order_documents') r`)).rows[0].r)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
