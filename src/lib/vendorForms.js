// Реєстр форм реєстрації проекту у вендорів + заповнення оригінального шаблону.
// Заповнюємо .xlsx-шаблон вендора через exceljs (зберігає стилі/рамки/об'єднання/інструкції).
// Додати вендора = додати шаблон у public/vendor-forms/ + конфіг у VENDORS.

export const VENDORS = [
  {
    key: 'canon',
    name: 'Canon',
    template: '/vendor-forms/canon.xlsx',
    sheet: 'Registration form',
    // Клітинки значень (адреса → джерело). manual — вводить користувач.
    fields: [
      { key: 'partner',          cell: 'D2',  label: 'Компанія-партнер',                auto: 'company' },
      { key: 'dealerCode',       cell: 'D3',  label: 'Код дилера у дистриб’ютора',      manual: true },
      { key: 'client',           cell: 'D4',  label: 'Замовник',                        auto: 'clientName' },
      { key: 'otherNames',       cell: 'D5',  label: 'Інші назви',                      manual: true },
      { key: 'clientContact',    cell: 'D6',  label: 'Контактний телефон/email',        auto: 'clientContact' },
      { key: 'clientEdrpou',     cell: 'D7',  label: 'Код ЄДРПОУ',                       auto: 'clientEdrpou' },
      { key: 'responsible',      cell: 'D8',  label: 'Відповідальна особа',             auto: 'responsible' },
      { key: 'deliveryTerm',     cell: 'D14', label: 'Термін постачання',               manual: true, type: 'date' },
      { key: 'distributor',      cell: 'D15', label: 'Дистриб’ютор',                    auto: 'distributor' },
      { key: 'authLetter',       cell: 'D16', label: 'Авторизаційний лист',             manual: true, type: 'text' },
      { key: 'submissionPeriod', cell: 'D17', label: 'Період подання пропозицій',       manual: true, type: 'date' },
      { key: 'comments',         cell: 'D18', label: 'Коментарі',                       manual: true, type: 'text' },
    ],
    // Устаткування: рядки шаблону, куди пишемо позиції замовлення
    items: { startRow: 10, maxRows: 4, model: 'D', qty: 'F', price: 'G' },
    fileName: (order) => `Canon_Project_Registration_${order?.order_number || ''}.xlsx`,
  },
  {
    key: 'comel',
    name: 'Комел',
    template: '/vendor-forms/comel.xlsx',
    sheet: 'Лист1',
    // Форма для отримання партнерського листа ТОВ «Комел».
    // Мітки в колонці A, значення пишемо в колонку B. У формі перелічуються ВСІ
    // товари закупівлі (не за брендом) → selectAll.
    selectAll: true,
    fields: [
      { key: 'partner',        cell: 'B4',  label: 'Назва юр. особи партнера',            auto: 'company' },
      { key: 'partnerEdrpou',  cell: 'B5',  label: 'ОКПО партнера',                       default: 'UC0561131' },
      { key: 'partnerAddress', cell: 'B6',  label: 'Юр. адреса партнера',                 auto: 'companyAddress', type: 'text' },
      { key: 'contract',       cell: 'B7',  label: 'Номер та дата договору з ТОВ «Комел»', default: 'КОЕ 1065 від 07.04.2025 р.', type: 'text' },
      { key: 'procurementId',  cell: 'B9',  label: 'Ідентифікатор закупівлі',             auto: 'procurementId' },
      { key: 'procurementUrl', cell: 'B10', label: 'Посилання на закупівлю',              auto: 'procurementUrl', type: 'text' },
      { key: 'client',         cell: 'B11', label: 'Назва замовника',                     auto: 'clientName' },
      { key: 'clientAddress',  cell: 'B12', label: 'Адреса замовника',                    auto: 'clientAddress', type: 'text' },
    ],
    // Устаткування → один текстовий осередок «Предмет закупівлі» (B14), позиції списком
    items: { mode: 'join', cell: 'B14', sep: '\n', withQty: true, maxRows: 200 },
    fileName: (order) => `Комел_партнерський_лист_${order?.order_number || ''}.xlsx`,
  },
]

export const getVendor = (key) => VENDORS.find(v => v.key === key)

// Заповнити шаблон вендора значеннями і повернути Blob (.xlsx) — стилі шаблону зберігаються.
export async function fillVendorForm(vendor, values, items) {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const res = await fetch(vendor.template)
  if (!res.ok) throw new Error(`Не вдалося завантажити шаблон (${res.status})`)
  const buf = await res.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.getWorksheet(vendor.sheet) || wb.worksheets[0]

  // Поля
  for (const f of vendor.fields) {
    const v = values[f.key]
    if (v == null || v === '') continue
    ws.getCell(f.cell).value = v
  }

  // Устаткування
  const it = vendor.items
  const list = (items || []).filter(x => (x.name || '').trim())
  const shown = list.slice(0, it.maxRows)
  if (it.mode === 'join') {
    // Усі позиції списком в один осередок (напр. «Предмет закупівлі»)
    const text = shown.map(x => {
      const q = Number(x.qty) || 0
      return it.withQty && q ? `${x.name} — ${q} шт` : x.name
    }).join(it.sep || '\n')
    const cell = ws.getCell(it.cell)
    cell.value = text
    cell.alignment = { ...(cell.alignment || {}), wrapText: true, vertical: 'top' }
  } else {
    // Рядки таблиці (модель / к-сть / ціна)
    shown.forEach((x, i) => {
      const row = it.startRow + i
      ws.getCell(`${it.model}${row}`).value = x.name || ''
      ws.getCell(`${it.qty}${row}`).value = Number(x.qty) || 0
      // Ціна — лише якщо задана (порожнє поле лишаємо порожнім)
      if (it.price && x.price != null && x.price !== '') ws.getCell(`${it.price}${row}`).value = Number(x.price)
    })
  }

  const out = await wb.xlsx.writeBuffer()
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
