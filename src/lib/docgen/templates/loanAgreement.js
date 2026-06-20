// ── Шаблон: Договір поворотної безвідсоткової фінансової допомоги ──
import { formatMoney, formatDate, formatDateLong, amountInWords } from '../formatUtils'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
const G4 = '#E5E5EA'
const GREEN = '#00C853'

const aimLogo = (sz) => ({
  text: [
    { text: 'A', color: BLACK, bold: true }, { text: 'i', color: GREEN, bold: true },
    { text: 'M ', color: BLACK, bold: true }, { text: 'Sk', color: BLACK, bold: true },
    { text: 'i', color: GREEN, bold: true }, { text: 'll.', color: BLACK, bold: true },
  ], fontSize: sz || 8,
})

const section = (num, title) => ({ text: `${num}. ${title}`, fontSize: 11, bold: true, color: BLACK, margin: [0, 14, 0, 6] })
const clause = (num, text) => ({ text: [{ text: `${num} `, color: G2, fontSize: 9 }, { text: text }], fontSize: 9.5, lineHeight: 1.5, margin: [0, 0, 0, 4], color: G1 })

export function pdf(company, contractor, items, options) {
  const { docNumber, docDate, notes, city } = options
  // Для договорів: items[0] містить параметри
  const params = items[0] || {}
  const amount = parseFloat(params.amount) || 0
  const returnDate = params.returnDate || ''
  const returnPeriod = params.returnPeriod || '12 місяців'

  return {
    pageSize: 'A4',
    pageMargins: [44, 20, 44, 46],
    defaultStyle: { fontSize: 9.5, color: G1 },

    footer: (cp, pc) => ({
      margin: [44, 0, 44, 10],
      columns: [
        { text: `${docNumber} · ${formatDate(docDate)} · Стор. ${cp}/${pc}`, fontSize: 6, color: G3, margin: [0, 5, 0, 0] },
        { text: 'Сформовано в корпоративній системі AiM Skill', fontSize: 5.5, color: G3, alignment: 'center', margin: [0, 5, 0, 0] },
        { ...aimLogo(7), alignment: 'right', margin: [0, 3, 0, 0] },
      ],
    }),

    content: [
      // ═══ ЗАГОЛОВОК ═══
      { text: 'ДОГОВІР', fontSize: 16, bold: true, color: BLACK, alignment: 'center', margin: [0, 10, 0, 2] },
      { text: 'поворотної безвідсоткової фінансової допомоги', fontSize: 12, alignment: 'center', color: G1, margin: [0, 0, 0, 10] },

      {
        columns: [
          { text: `№ ${docNumber}`, fontSize: 11, bold: true, color: BLACK },
          { text: `${city || 'м. Київ'}`, fontSize: 10, color: G1, alignment: 'center' },
          { text: formatDateLong(docDate), fontSize: 10, color: G1, alignment: 'right' },
        ],
        margin: [0, 0, 0, 16],
      },

      // ═══ ПРЕАМБУЛА ═══
      {
        text: [
          { text: company.shortName || company.name, bold: true },
          { text: `, в особі ${company.directorPosition || 'Директора'} ` },
          { text: company.director || '________', bold: true },
          { text: ', що діє на підставі Статуту (надалі — ' },
          { text: '«Позикодавець»', bold: true },
          { text: '), з однієї сторони, та ' },
          { text: contractor.short_name || contractor.name || '________', bold: true },
          { text: `, в особі ${contractor.contact_position || '________'} ` },
          { text: contractor.contact_person || '________', bold: true },
          { text: ', що діє на підставі Статуту (надалі — ' },
          { text: '«Позичальник»', bold: true },
          { text: '), з іншої сторони (разом — Сторони), уклали цей Договір про наступне:' },
        ],
        fontSize: 9.5, lineHeight: 1.6, margin: [0, 0, 0, 6],
      },

      // ═══ 1. ПРЕДМЕТ ДОГОВОРУ ═══
      section('1', 'ПРЕДМЕТ ДОГОВОРУ'),
      clause('1.1.', `Позикодавець передає Позичальнику грошові кошти у розмірі ${formatMoney(amount)} (${amountInWords(amount).toLowerCase()}) грн (надалі — «Фінансова допомога»), а Позичальник зобов'язується повернути зазначену суму у строк та на умовах, визначених цим Договором.`),
      clause('1.2.', 'Фінансова допомога надається на безвідсотковій та поворотній основі.'),
      clause('1.3.', 'Фінансова допомога не є позикою у розумінні ст. 1046 Цивільного кодексу України та не передбачає нарахування процентів.'),

      // ═══ 2. ПОРЯДОК НАДАННЯ ═══
      section('2', 'ПОРЯДОК НАДАННЯ ФІНАНСОВОЇ ДОПОМОГИ'),
      clause('2.1.', 'Фінансова допомога надається шляхом безготівкового перерахування коштів на поточний рахунок Позичальника протягом 5 (п\'яти) банківських днів з дати підписання цього Договору.'),
      clause('2.2.', 'Датою надання фінансової допомоги вважається дата зарахування коштів на поточний рахунок Позичальника.'),

      // ═══ 3. ПОРЯДОК ПОВЕРНЕННЯ ═══
      section('3', 'ПОРЯДОК ТА СТРОКИ ПОВЕРНЕННЯ'),
      clause('3.1.', `Позичальник зобов'язується повернути фінансову допомогу в повному обсязі не пізніше ${returnDate ? formatDateLong(returnDate) : returnPeriod + ' з дати надання'}.`),
      clause('3.2.', 'Повернення здійснюється шляхом безготівкового перерахування коштів на поточний рахунок Позикодавця.'),
      clause('3.3.', 'Дострокове повернення фінансової допомоги допускається за згодою Сторін.'),
      clause('3.4.', `У разі порушення строку повернення Позичальник сплачує пеню у розмірі 0,1% від суми заборгованості за кожен день прострочення.`),

      // ═══ 4. ПРАВА ТА ОБОВ'ЯЗКИ ═══
      section('4', 'ПРАВА ТА ОБОВ\'ЯЗКИ СТОРІН'),
      clause('4.1.', 'Позикодавець зобов\'язується надати фінансову допомогу в порядку та строки, визначені цим Договором.'),
      clause('4.2.', 'Позичальник зобов\'язується використати кошти виключно для потреб господарської діяльності та повернути їх у встановлений строк.'),
      clause('4.3.', 'Позичальник має право повернути фінансову допомогу достроково.'),

      // ═══ 5. ВІДПОВІДАЛЬНІСТЬ ═══
      section('5', 'ВІДПОВІДАЛЬНІСТЬ СТОРІН'),
      clause('5.1.', 'За невиконання або неналежне виконання зобов\'язань за цим Договором Сторони несуть відповідальність відповідно до чинного законодавства України.'),
      clause('5.2.', 'Сплата пені та/або штрафу не звільняє Позичальника від обов\'язку повернути фінансову допомогу.'),

      // ═══ 6. ФОРС-МАЖОР ═══
      section('6', 'ФОРС-МАЖОРНІ ОБСТАВИНИ'),
      clause('6.1.', 'Сторони звільняються від відповідальності за часткове або повне невиконання зобов\'язань за цим Договором, якщо це стало наслідком дії обставин непереборної сили (форс-мажор).'),

      // ═══ 7. СТРОК ДІЇ ═══
      section('7', 'СТРОК ДІЇ ДОГОВОРУ'),
      clause('7.1.', 'Цей Договір набуває чинності з моменту його підписання Сторонами і діє до повного виконання Сторонами своїх зобов\'язань.'),
      clause('7.2.', 'Договір може бути розірвано за взаємною згодою Сторін.'),

      // ═══ 8. ІНШІ УМОВИ ═══
      section('8', 'ІНШІ УМОВИ'),
      clause('8.1.', 'Усі зміни та доповнення до цього Договору дійсні лише за умови, якщо вони здійснені у письмовій формі та підписані обома Сторонами.'),
      clause('8.2.', 'Цей Договір складено у двох примірниках, що мають однакову юридичну силу, по одному для кожної зі Сторін.'),
      clause('8.3.', 'У випадках, не передбачених цим Договором, Сторони керуються чинним законодавством України.'),

      notes ? { text: `Примітка: ${notes}`, fontSize: 8.5, color: G2, italics: true, margin: [0, 10, 0, 0] } : {},

      // ═══ 9. РЕКВІЗИТИ СТОРІН ═══
      section('9', 'РЕКВІЗИТИ ТА ПІДПИСИ СТОРІН'),
      { text: '', margin: [0, 4] },
      {
        columns: [
          partyRequisites('ПОЗИКОДАВЕЦЬ', company, true),
          { width: 20, text: '' },
          partyRequisites('ПОЗИЧАЛЬНИК', contractor, false),
        ],
      },
    ],
  }
}

function partyRequisites(title, entity, isCompany) {
  const name = isCompany ? (entity.shortName || entity.name) : (entity.short_name || entity.name || '—')
  const director = isCompany ? entity.director : entity.contact_person
  const position = isCompany ? (entity.directorPosition || 'Директор') : (entity.contact_position || '')

  return {
    width: '*',
    stack: [
      { text: title, fontSize: 8, letterSpacing: 2, color: G2, bold: true, margin: [0, 0, 0, 6] },
      { text: name, fontSize: 10, bold: true, color: BLACK, margin: [0, 0, 0, 3] },
      entity.edrpou ? { text: `ЄДРПОУ: ${entity.edrpou}`, fontSize: 8, color: G1, margin: [0, 0, 0, 1] } : {},
      (isCompany ? entity.address : (entity.legal_address || entity.address)) ? { text: isCompany ? entity.address : (entity.legal_address || entity.address), fontSize: 8, color: G2, margin: [0, 0, 0, 1] } : {},
      (isCompany ? entity.iban : entity.iban) ? { text: `IBAN: ${isCompany ? entity.iban : entity.iban}`, fontSize: 7.5, color: G2, margin: [0, 0, 0, 1] } : {},
      isCompany && entity.bankName ? { text: `${entity.bankName}${entity.mfo ? ', МФО ' + entity.mfo : ''}`, fontSize: 7.5, color: G2, margin: [0, 0, 0, 1] } : {},
      { text: '', margin: [0, 20] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
      { text: `${position} ${director || ''}`.trim(), fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
      { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 5, 0, 0] },
    ],
  }
}

export function xlsx() { return null }
