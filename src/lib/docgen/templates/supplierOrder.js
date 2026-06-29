// ── Шаблон: Замовлення постачальнику ──
// Від кого: наша компанія; Кому: постачальник; Для клієнта: клієнт замовлення.
import { formatDateLong } from '../formatUtils'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const DARK = '#1C1C1E'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
const G4 = '#E5E5EA'

const rvLine = (label, value) => value ? {
  columns: [
    { text: label, width: 42, fontSize: 8, color: G2, alignment: 'left', margin: [0, 0, 2, 0] },
    { text: value, width: '*', fontSize: 8, color: G1 },
  ], margin: [0, 1, 0, 1],
} : null

const sectionTitle = (text) => ({ text, fontSize: 7.5, letterSpacing: 2, color: G2, bold: true, margin: [0, 0, 0, 6] })

const PROCUREMENT = { tender: 'Тендер', direct: 'Пряма закупівля' }

export function pdf(company, supplier, items, options) {
  const { docNumber, docDate, client, procurementType, notes } = options
  const rows = items.map((it, i) => ({ n: i + 1, name: it.name || '', sku: it.sku || '', u: it.unit || 'шт', q: parseFloat(it.quantity) || 0 }))

  return {
    pageSize: 'A4',
    pageMargins: [40, 20, 40, 56],
    defaultStyle: { fontSize: 9, color: G1 },

    footer: () => ({
      margin: [40, 0, 40, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.3, lineColor: G4 }], margin: [0, 0, 0, 5] },
        { columns: [
          { stack: [
            { text: docNumber, fontSize: 6, bold: true, color: G2 },
            { text: 'Сформовано в корпоративній системі AiM Skill  ·  073 700 77 58  ·  office@aim-skill.com.ua', fontSize: 5.5, color: G3, margin: [0, 1, 0, 0] },
          ], width: '*', margin: [0, 3, 0, 0] },
          { image: LOGO_BASE64, width: 52, alignment: 'right' },
        ] },
      ],
    }),

    content: [
      sectionTitle('ЗАМОВЛЕННЯ ПОСТАЧАЛЬНИКУ'),
      { text: `від ${formatDateLong(docDate)}`, fontSize: 9, color: G1, margin: [0, 0, 0, 2] },
      { text: `№ ${docNumber}`, fontSize: 22, bold: true, color: BLACK, margin: [0, 0, 0, 12] },

      {
        columns: [
          { width: '49%', stack: [
            sectionTitle('ВІД КОГО'),
            { text: company.shortName || company.name, fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
            rvLine('ЄДРПОУ', company.edrpou),
            rvLine('Адреса', company.address),
            rvLine('Тел.', company.phone),
            rvLine('Email', company.email),
          ].filter(Boolean) },
          { width: '2%', text: '' },
          { width: '49%', stack: [
            sectionTitle('КОМУ (ПОСТАЧАЛЬНИК)'),
            { text: supplier.short_name || supplier.name || '—', fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
            rvLine('ЄДРПОУ', supplier.edrpou),
            rvLine('Адреса', supplier.legal_address || supplier.address),
            rvLine('Тел.', supplier.phone),
            rvLine('Email', supplier.email),
          ].filter(Boolean) },
        ],
        margin: [0, 0, 0, 8],
      },

      // ── Для клієнта (з реквізитами) + тип закупівлі ──
      client ? {
        stack: [
          sectionTitle('ДЛЯ КЛІЄНТА'),
          { text: client.short_name || client.name || '—', fontSize: 9.5, bold: true, color: BLACK, margin: [0, 0, 0, 4] },
          rvLine('ЄДРПОУ', client.edrpou),
          rvLine('Адреса', client.legal_address || client.address),
        ].filter(Boolean),
        margin: [0, 0, 0, 8],
      } : { text: '', margin: [0, 0, 0, 4] },

      procurementType ? { text: [{ text: 'Тип закупівлі: ', color: G2 }, { text: PROCUREMENT[procurementType] || procurementType, color: BLACK, bold: true }], fontSize: 9, margin: [0, 0, 0, 10] } : { text: '', margin: [0, 0, 0, 4] },

      {
        table: {
          headerRows: 1,
          widths: [22, 90, '*', 44, 54],
          body: [
            ['№', 'Код', 'Найменування', 'Од.', 'К-сть'].map(t => ({
              text: t, fontSize: 6.5, bold: true, color: '#FFF', fillColor: DARK, alignment: 'center', margin: [0, 3, 0, 3],
            })),
            ...rows.map(r => [
              { text: r.n, alignment: 'center', fontSize: 8.5, color: G2 },
              { text: r.sku || '—', fontSize: 8, color: G1 },
              { text: r.name, fontSize: 8.5, color: BLACK },
              { text: r.u, alignment: 'center', fontSize: 8, color: G2 },
              { text: r.q, alignment: 'center', fontSize: 9, bold: true, color: BLACK },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i) => i === 0 ? 0 : i === 1 ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? DARK : G4,
          paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4,
          fillColor: (i) => i > 0 && i % 2 === 0 ? '#FAFAFA' : null,
        },
      },

      notes ? { text: notes, fontSize: 8.5, color: G1, margin: [0, 10, 0, 0], lineHeight: 1.4 } : {},

      { text: '', margin: [0, 14] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: G4 }], margin: [0, 0, 0, 6] },
      { width: '48%', stack: [
        { text: 'ЗАМОВИВ', fontSize: 6.5, letterSpacing: 2, color: G2, margin: [0, 0, 0, 12] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
        { text: `${company.directorPosition || 'Директор'} ${company.director || ''}`, fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
      ] },
    ],
  }
}
