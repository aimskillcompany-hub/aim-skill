import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite(); const q = (s, p) => db.query(s, p)
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
await db.exec(`create table contractors (id serial primary key, name text, edrpou text);
  insert into contractors (name, edrpou) values
  ('Товариство з обмеженою відповідальністю "НКТ"', '1'), ('ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «ІВІНГ»', '2'),
  ('Товариство з Обмеженою Відповідальністю "ЛЕП"', '3'), ('ТОВ "КОМЕЛ"', '4'), ('ФОП Пекар Ярослава Іванівна', '5'),
  ('ПП "Товариство з обмеженою відповідальністю"', '6')`)
const sql = fs.readFileSync('/Users/dmitroredko/claude-projects/aim-skill/migrations/104_contractor_short_tov.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
const n = Object.fromEntries((await q('select edrpou, name from contractors')).rows.map(r => [r.edrpou, r.name]))
ok('звичайний регістр', n['1'] === 'ТОВ "НКТ"')
ok('великі літери', n['2'] === 'ТОВ «ІВІНГ»')
ok('змішаний регістр', n['3'] === 'ТОВ "ЛЕП"')
ok('вже коротка — без змін', n['4'] === 'ТОВ "КОМЕЛ"')
ok('ФОП — без змін', n['5'] === 'ФОП Пекар Ярослава Іванівна')
ok('повна форма не на початку — без змін', n['6'] === 'ПП "Товариство з обмеженою відповідальністю"')
await q(`insert into contractors (name, edrpou) values ('товариство з обмеженою відповідальністю "НОВЕ"', '7')`)
await q(`update contractors set name = 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ "ЗМІНА"' where edrpou = '4'`)
const m = Object.fromEntries((await q('select edrpou, name from contractors')).rows.map(r => [r.edrpou, r.name]))
ok('нова — скорочується тригером', m['7'] === 'ТОВ "НОВЕ"')
ok('зміна назви — скорочується тригером', m['4'] === 'ТОВ "ЗМІНА"')
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
