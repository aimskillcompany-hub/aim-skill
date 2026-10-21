import * as XLSX from 'xlsx'
import { buildWorkbookRows, buildPlan, applyPlan, toISO } from './bundle.mjs'
globalThis.calls = []
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const P = (n, name, sku = null, extra = {}) => ({ id: id(n), name, sku, unit: 'шт', product_type: 'goods', status: 'active', total_in: 0, total_out: 0, ...extra })
const products = [
  P(1, 'Forensic-набір Digital Intelligence UltraBay 4 Portable Complete Set', 'W3534', { total_in: 1, total_out: 1 }),
  P(2, 'Пристрій блокування запису UltraBlock USB3 Kit', null, { total_in: 1, total_out: 1 }),
  P(3, 'Корпус ATX без блока живлення', 'Nova N6', { total_in: 3, total_out: 3 }),
  P(4, 'Корпус ATX GAMEMAX Black Diamond CP', null, { total_in: 9, total_out: 5 }),
  P(5, 'Ноутбук 18.5" AMD Ryzen 5', null, { total_in: 5, total_out: 2 }),
  P(6, 'Монтажний комплект ETI', null, { total_in: 2, total_out: 2 }),
  P(7, 'Щит пластиковий ETI ECH 24PT', null, { total_in: 2 }),
  P(8, 'Розширювач PFT1300', null, { total_in: 1, total_out: 1 }),
  P(9, 'Forensic-набір Digital Intelligence UltraKit v5', 'W3008', { total_in: 1, total_out: 1 }),
]
const D = (n, num, date, contractor_id = 'c1', extra = {}) => ({ id: id(100 + n), type: 'waybill', doc_number: num, doc_date: date, contractor_id, amount: 1000, day_order: null, created_at: date + 'T10:00', contractors: { name: 'К' + contractor_id }, ...extra })
const docs = [D(1, '3', '2025-06-06'), D(2, '2109', '2026-10-09', 'c2'), D(3, 'ВН-0044', '2026-10-09', 'c3'), D(4, '13', '2026-04-30', 'c4'), D(5, '48', '2026-05-28', 'c5'), D(6, 'б/н', '2026-05-27', 'c5'), D(7, '13', '2026-02-01', 'c4')]
const dn = (n) => ({ doc_number: docs[n - 1].doc_number, doc_date: docs[n - 1].doc_date, contractors: docs[n - 1].contractors })
const M = (n, pid, type, qty, price, date, doc = null, extra = {}) => ({ id: id(200 + n), product_id: id(pid), type, quantity: qty, price, cost_price: price, date, description: 'X: ' + products[pid - 1].name, source: doc ? 'document' : 'manual', document_id: doc ? id(100 + doc) : null, assembly_id: null, documents: doc ? dn(doc) : null, ...extra })
const ASM = id(500)
const movs = [
  M(1, 3, 'in', 3, 1130, '2025-04-17'), M(2, 3, 'out', 3, 1500, '2025-06-06', 1), M(3, 4, 'in', 9, 1612, '2025-05-29'),
  M(4, 5, 'in', 5, 20000, '2026-10-09', 2), M(5, 5, 'out', 2, 0, '2026-10-09', 3),
  M(6, 9, 'in', 1, 398000, '2026-05-28', 5), M(7, 9, 'out', 1, 0, '2026-04-30', 4), M(8, 1, 'in', 1, 169500, '2026-05-28', 5), M(9, 1, 'out', 1, 0, '2026-04-30', 4),
  M(10, 7, 'in', 2, 1326, '2026-08-31'), M(11, 8, 'in', 1, 300, '2026-08-31'),
  M(12, 8, 'out', 1, 300, '2026-09-10', null, { source: 'assembly', assembly_id: ASM }), M(13, 6, 'in', 2, 4276.73, '2026-09-10', null, { source: 'assembly', assembly_id: ASM }),
  M(14, 6, 'out', 1, 0, '2026-09-17', null, { source: 'document', document_id: id(150), documents: { doc_number: 'ВН-0031/1' } }),
  M(15, 6, 'out', 1, 0, '2026-09-15', null, { source: 'document', document_id: id(151), documents: { doc_number: 'ВН-0031' } }),
]
const aliases = [
  { id: id(301), product_id: id(9), alias: 'UltraKit v5', created_at: '2026-01-01' }, { id: id(302), product_id: id(9), alias: 'Комплект UltraKit v5 повний', created_at: '2026-01-02' },
  { id: id(303), product_id: id(9), alias: 'Комплект  UltraKit v5 повний', created_at: '2026-01-03' }, { id: id(304), product_id: id(1), alias: 'UltraBay 4 Portable (complete set)', created_at: '2026-01-01' },
  { id: id(305), product_id: id(1), alias: 'UltraBay 4 Portable (complete set)', created_at: '2026-01-04' }, { id: id(306), product_id: id(2), alias: "Пристрій блокування запису UltraBlock USB3 Kit", created_at: '2026-01-01' },
  { id: id(307), product_id: id(2), alias: 'Помилковий синонім', created_at: '2026-01-01' },
]
const assemblies = [{ id: ASM, name: 'Монтажний комплект ETI', result_product_id: id(6), quantity: 2, total_cost: 8553.45, assembled_at: '2026-09-10', manual_unit_cost: null }]
const asmItems = [{ id: id(511), assembly_id: ASM, product_id: id(8), quantity: 1, cost_price: 300 }]
const asmAlloc = [{ in_movement_id: id(213), out_movement_id: id(214), qty: 1 }, { in_movement_id: id(213), out_movement_id: id(215), qty: 1 }]
const data = { products, movs, aliases, docs, assemblies, asmItems, asmAlloc, closed: ['2025-06'] }
const w = buildWorkbookRows(data)
ok(`аркуші: рухів ${w.movRows.length}, документів ${w.docRows.length}, збірки рядків ${w.asmRows.length}, синонімів ${w.alRows.length}`, w.movRows.length === 15 && w.docRows.length === 7 && w.asmRows.length === 2)
ok('синоніми без дублів (UltraKit «повний» ×2 → 1, UltraBay ×2 → 1)', w.alRows.filter(r => r['ID картки'] === id(9)).length === 2 && w.alRows.filter(r => r['ID картки'] === id(1)).length === 1)
ok('документ б/н і повтор номера 13 у контрагента — ⚠', /б\/н/.test(w.docRows.find(r => r['Номер'] === 'б/н')['⚠']) && /повторюється/.test(w.docRows.find(r => r['ID документа'] === id(104))['⚠']))
ok('порядок у дні: 2109 (прихід) = 1 (авто), ВН-0044 = 2 (авто)', w.docRows.find(r => r['Номер'] === '2109')['Порядок у дні'] === '1 (авто)' && w.docRows.find(r => r['Номер'] === 'ВН-0044')['Порядок у дні'] === '2 (авто)')
ok('збірка: розбіжність дат не позначена (усі 10.09)', w.asmRows[0]['Розбіжність'] === '')

// Excel туди й назад
const wb = XLSX.utils.book_new()
for (const [n, rows] of [['Рухи', w.movRows], ['Картки', w.cardRows], ['Синоніми', w.alRows], ['Документи', w.docRows], ['Збірки', w.asmRows]]) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n)
const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true })
const R = (n) => XLSX.utils.sheet_to_json(back.Sheets[n], { defval: '' })
const f = { movRows: R('Рухи'), cardRows: R('Картки'), alRows: R('Синоніми'), docRows: R('Документи'), asmRows: R('Збірки') }
const row = (sheet, key, val) => f[sheet].find(r => r[key] === val)
// 1, 2: артикули
row('cardRows', 'ID картки', id(1))['Новий артикул'] = 'W5170'
row('cardRows', 'ID картки', id(2))['Новий артикул'] = 'W2420'
row('cardRows', 'ID картки', id(9))['Новий артикул'] = 'W5170'          // дубль артикулу → попередження
row('cardRows', 'ID картки', id(4))['Нова назва'] = 'Корпус ATX без блока живлення'   // зайнята назва → пропуск
// 3: частина продажу №3 → Black Diamond (2025-06 закритий → пропуск), і ще варіант без закриття
row('movRows', 'ID руху', id(202))['Перенести на картку'] = 'Корпус ATX GAMEMAX Black Diamond CP'
row('movRows', 'ID руху', id(202))['К-сть до перенесення'] = 1
// 4: №13 → 28.05.2026, №48 першим у дні
row('docRows', 'ID документа', id(104))['Нова дата'] = '28.05.2026'
row('docRows', 'ID документа', id(104))['Новий порядок у дні'] = 2
row('docRows', 'ID документа', id(105))['Новий порядок у дні'] = 1
// 5: 2109 = 1, ВН-0044 = 2
row('docRows', 'ID документа', id(102))['Новий порядок у дні'] = 1
row('docRows', 'ID документа', id(103))['Новий порядок у дні'] = 2
// 6: збірка
const head = f.asmRows.find(r => r['Роль'] === 'виріб'); head['Дата збірки'] = '15.09.2026'
f.asmRows.find(r => r['ID рядка'] === id(511))['К-сть'] = 0
f.asmRows.push({ 'ID збірки': ASM, 'ID рядка': '', 'Роль': '', 'Картка компонента': 'Щит пластиковий ETI ECH 24PT', 'К-сть': 2 })
// 8: видалити синонім; заборона — останній, що збігається з назвою
row('alRows', 'Синонім', 'Помилковий синонім')['Перенести на картку'] = 'видалити'
row('alRows', 'Синонім', 'Пристрій блокування запису UltraBlock USB3 Kit')['Перенести на картку'] = 'видалити'
const plan = buildPlan(f, data)
console.log('    пропущено:', plan.errors)
console.log('    cards:', JSON.stringify(plan.cards.map(c => [c.name.slice(0,20), c.sku, c.warnings]))); ok('1–2: артикули W5170, W2420; дубль W5170 у UltraKit — попередження', plan.cards.some(c => c.id === id(1) && c.sku.to === 'W5170') && plan.cards.some(c => c.id === id(2) && c.sku.from === null && c.sku.to === 'W2420')
  && plan.cards.find(c => c.id === id(9)).warnings.length === 1)
ok('нова назва, що вже є, — пропуск', plan.errors.some(e => /уже є в іншій картці/.test(e)))
ok('3: продаж 2025-06 (закритий) — пропуск «закритий період»', plan.errors.some(e => /Рухи.*закритий період/.test(e)))
const d13 = plan.docs.find(d => d.id === id(104))
ok('4: №13 → 28.05.2026, порядок 2; №48 порядок 1; без ⚠ видаток до приходу', d13.newDate === '2026-05-28' && d13.order === 2 && !d13.warnings.some(x => /до приходу/.test(x)))
ok('5: 2109 = 1, ВН-0044 = 2', plan.docs.find(d => d.id === id(102)).order === 1 && plan.docs.find(d => d.id === id(103)).order === 2)
const a = plan.assemblies[0]
console.log('    збірка:', JSON.stringify({ newDate: a.newDate, items: a.itemsView, oldUnit: a.oldUnit, estUnit: a.estUnit, warnings: a.warnings }))
ok('6: дата 15.09, PFT прибрати, ETI +2, ≈ (2×1326)/2 = 1326, попередження про ВН-0031 і ВН-0031/1', a.newDate === '2026-09-15' && a.items.some(x => x.item_id === null && x.product_id === id(7) && x.qty === 2)
  && a.items.some(x => x.item_id === id(511) && x.qty === 0) && a.estUnit === 1326 && a.warnings.some(x => /ВН-0031\/1/.test(x) && /ВН-0031(,|$)/.test(x)))
ok('7: дублі синонімів прибираються автоматично (2 шт)', plan.aliases.dedupe.reduce((s, x) => s + x.ids.length, 0) === 2)
ok('8: «Помилковий синонім» — видалити; останній = назва картки — пропуск', plan.aliases.deletes.length === 1 && plan.errors.some(e => /останній синонім/.test(e)))
// змінено після вивантаження
const f2 = JSON.parse(JSON.stringify(f)); const data2 = { ...data, docs: data.docs.map(d => d.id === id(102) ? { ...d, doc_number: '2109-X' } : d) }
ok('змінено після вивантаження — пропуск', buildPlan(f2, data2).errors.some(e => /2109|Документи/.test(e) && /змінено після вивантаження/.test(e)))
// 9: застосування — порядок картки → документи → рухи → збірки → синоніми
await applyPlan(plan)
const seq = calls.map(c => c[0] === 'update' ? 'product_type' : c[0])
console.log('    виклики:', seq.join(' → '))
const pos = (fn) => seq.indexOf(fn)
ok('9: порядок застосування з ТЗ', pos('product_fix') < pos('doc_fix') && pos('doc_fix') < pos('assembly_fix') && pos('assembly_fix') < pos('alias_delete'))
// дата
ok('toISO: 28.05.2026, 2026-05-28, Excel-число, Date', toISO('28.05.2026') === '2026-05-28' && toISO('2026-05-28') === '2026-05-28' && toISO(46170) === '2026-05-28' && toISO(new Date(2026, 4, 28)) === '2026-05-28')
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
