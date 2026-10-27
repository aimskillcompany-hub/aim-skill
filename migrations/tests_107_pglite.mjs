import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const fail = async (sql, p) => { try { await q(sql, p); return null } catch (e) { return e.message } }
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001', MGR = 'aaaaaaaa-0000-0000-0000-000000000002', VIEW = 'aaaaaaaa-0000-0000-0000-000000000003'
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role authenticated;
  create table profiles (id uuid primary key, role text);
  insert into profiles values ('${ADMIN}', 'admin'), ('${MGR}', 'manager'), ('${VIEW}', 'viewer');
  create function is_admin() returns boolean language sql as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;
  create table contractors (id uuid primary key default gen_random_uuid(), name text);
  insert into contractors (name) values ('ТОВ «КОМЕЛ»');
  -- заглушка Supabase Vault
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text, description text);
  create function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
  create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
  create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/107_supplier_portals.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
const as = (u) => q(`select set_config('test.uid', $1, false)`, [u])
await as(MGR)
const pid = (await q(`insert into supplier_portals (contractor_id, title, url, login, has_password) select id, 'Комел B2B', 'https://b2b.komel.ua', 'aim', true from contractors returning id`)).rows[0].id
ok('клієнт не може сам поставити «є пароль»', (await q('select has_password from supplier_portals')).rows[0].has_password === false)
await q('select portal_set_password($1, $2)', [pid, 'S3cret!'])
ok('пароль у Vault, не в таблиці порталу', (await q(`select count(*)::int n from vault.secrets where secret = 'S3cret!'`)).rows[0].n === 1 && (await q('select has_password from supplier_portals')).rows[0].has_password === true)
ok('менеджер бачить пароль', (await q('select portal_get_password($1) p', [pid])).rows[0].p === 'S3cret!')
await q('select portal_set_password($1, $2)', [pid, 'New#2'])
ok('зміна пароля — той самий секрет', (await q(`select count(*)::int n from vault.secrets`)).rows[0].n === 1 && (await q('select portal_get_password($1) p', [pid])).rows[0].p === 'New#2')
await as(VIEW)
ok('«перегляд» пароль не отримує', /PORTAL_FORBIDDEN/.test(await fail('select portal_get_password($1)', [pid]) || ''))
ok('«перегляд» не змінює пароль', /PORTAL_FORBIDDEN/.test(await fail('select portal_set_password($1, $2)', [pid, 'x']) || ''))
await as(ADMIN)
ok('журнал: перегляди й зміни', (await q(`select count(*)::int n from supplier_portal_log where action = 'reveal'`)).rows[0].n === 2 && (await q(`select count(*)::int n from supplier_portal_log where action = 'set'`)).rows[0].n === 2)
await q('select portal_set_password($1, $2)', [pid, ''])
ok('порожній пароль — секрет видалено', (await q(`select count(*)::int n from vault.secrets`)).rows[0].n === 0 && (await q('select has_password from supplier_portals')).rows[0].has_password === false)
await q('select portal_set_password($1, $2)', [pid, 'again'])
await q('delete from supplier_portals where id = $1', [pid])
ok('видалили портал — секрет у Vault теж', (await q(`select count(*)::int n from vault.secrets`)).rows[0].n === 0)
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
