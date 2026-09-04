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

  // Устаткування (модель / к-сть / ціна)
  const it = vendor.items
  const list = (items || []).filter(x => (x.name || '').trim())
  const shown = list.slice(0, it.maxRows)
  shown.forEach((x, i) => {
    const row = it.startRow + i
    ws.getCell(`${it.model}${row}`).value = x.name || ''
    ws.getCell(`${it.qty}${row}`).value = Number(x.qty) || 0
    if (it.price) ws.getCell(`${it.price}${row}`).value = Number(x.price) || 0
  })

  const out = await wb.xlsx.writeBuffer()
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
