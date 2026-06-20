// ── Шаблон: Договір поставки ──
import { formatMoney, formatDate, formatDateLong, amountInWords } from '../formatUtils'
import { LOGO_BASE64 } from '../logo'

const BLACK = '#0A0A0A'
const G1 = '#3A3A3C'
const G2 = '#8E8E93'
const G3 = '#C7C7CC'
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
  const { docNumber, docDate, notes, city, deliveryBasis, deliveryAddress } = options
  const params = items[0] || {}
  const paymentTerms = params.paymentTerms || '5 банківських днів з моменту отримання товару'
  const deliveryTerms = params.deliveryTerms || '10 робочих днів з моменту підписання Договору'
  const warrantyPeriod = params.warrantyPeriod || '12 місяців'

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
      { text: 'ДОГОВІР ПОСТАВКИ', fontSize: 16, bold: true, color: BLACK, alignment: 'center', margin: [0, 10, 0, 10] },
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
          { text: '«Постачальник»', bold: true },
          { text: '), з однієї сторони, та ' },
          { text: contractor.short_name || contractor.name || '________', bold: true },
          { text: `, в особі ${contractor.contact_position || '________'} ` },
          { text: contractor.contact_person || '________', bold: true },
          { text: ', що діє на підставі Статуту (надалі — ' },
          { text: '«Покупець»', bold: true },
          { text: '), з іншої сторони (разом — Сторони), уклали цей Договір про наступне:' },
        ],
        fontSize: 9.5, lineHeight: 1.6, margin: [0, 0, 0, 6],
      },

      // ═══ 1. ПРЕДМЕТ ═══
      section('1', 'ПРЕДМЕТ ДОГОВОРУ'),
      clause('1.1.', 'Постачальник зобов\'язується передати у власність Покупця товар (далі — «Товар»), а Покупець зобов\'язується прийняти та оплатити його на умовах, визначених цим Договором.'),
      clause('1.2.', 'Найменування, кількість, асортимент, ціна та інші характеристики Товару визначаються у Специфікаціях (Додатках), Рахунках та/або Видаткових накладних, що є невід\'ємними частинами цього Договору.'),
      clause('1.3.', 'Якість Товару має відповідати стандартам виробника та чинному законодавству України.'),

      // ═══ 2. ЦІНА ТА ПОРЯДОК ОПЛАТИ ═══
      section('2', 'ЦІНА ТА ПОРЯДОК РОЗРАХУНКІВ'),
      clause('2.1.', 'Ціна Товару визначається у Специфікаціях, Рахунках та/або Видаткових накладних і включає вартість пакування та маркування.'),
      clause('2.2.', `Оплата здійснюється шляхом безготівкового перерахування коштів на поточний рахунок Постачальника протягом ${paymentTerms}.`),
      clause('2.3.', 'Моментом оплати вважається дата зарахування коштів на розрахунковий рахунок Постачальника.'),

      // ═══ 3. ПОСТАВКА ═══
      section('3', 'УМОВИ ТА СТРОКИ ПОСТАВКИ'),
      clause('3.1.', `Поставка Товару здійснюється протягом ${deliveryTerms}.`),
      clause('3.2.', `Базис поставки: ${deliveryBasis || 'EXW'} (Інкотермс 2020).`),
      deliveryAddress ? clause('3.3.', `Адреса поставки: ${deliveryAddress}.`) : {},
      clause(deliveryAddress ? '3.4.' : '3.3.', 'Датою поставки вважається дата підписання Покупцем Видаткової накладної.'),

      // ═══ 4. ПРИЙМАННЯ ═══
      section('4', 'ПРИЙМАННЯ ТОВАРУ'),
      clause('4.1.', 'Приймання Товару за кількістю та якістю здійснюється у момент поставки на підставі Видаткової накладної.'),
      clause('4.2.', 'У разі виявлення невідповідності кількості або якості Товару Покупець зобов\'язаний повідомити Постачальника протягом 3 (трьох) робочих днів.'),

      // ═══ 5. ГАРАНТІЯ ═══
      section('5', 'ГАРАНТІЙНІ ЗОБОВ\'ЯЗАННЯ'),
      clause('5.1.', `Гарантійний строк на Товар становить ${warrantyPeriod} з дати поставки, якщо інше не зазначено у Специфікації.`),
      clause('5.2.', 'Гарантія не поширюється на пошкодження, спричинені неправильною експлуатацією, зберіганням або транспортуванням Покупцем.'),

      // ═══ 6. ВІДПОВІДАЛЬНІСТЬ ═══
      section('6', 'ВІДПОВІДАЛЬНІСТЬ СТОРІН'),
      clause('6.1.', 'За порушення строків поставки Постачальник сплачує пеню у розмірі 0,1% від вартості непоставленого Товару за кожен день прострочення.'),
      clause('6.2.', 'За порушення строків оплати Покупець сплачує пеню у розмірі 0,1% від суми заборгованості за кожен день прострочення.'),

      // ═══ 7. ФОРС-МАЖОР ═══
      section('7', 'ФОРС-МАЖОРНІ ОБСТАВИНИ'),
      clause('7.1.', 'Сторони звільняються від відповідальності за невиконання зобов\'язань у разі дії обставин непереборної сили, підтверджених ТПП України.'),

      // ═══ 8. СТРОК ДІЇ ═══
      section('8', 'СТРОК ДІЇ ТА ПОРЯДОК РОЗІРВАННЯ'),
      clause('8.1.', 'Договір набуває чинності з моменту підписання і діє до 31 грудня поточного року, а в частині розрахунків — до повного їх завершення.'),
      clause('8.2.', 'Договір може бути розірвано за взаємною згодою Сторін або в односторонньому порядку з письмовим повідомленням за 30 календарних днів.'),

      // ═══ 9. ІНШІ УМОВИ ═══
      section('9', 'ІНШІ УМОВИ'),
      clause('9.1.', 'Усі зміни та доповнення до цього Договору дійсні, якщо здійснені у письмовій формі та підписані обома Сторонами.'),
      clause('9.2.', 'Цей Договір складено у двох примірниках, що мають однакову юридичну силу.'),
      clause('9.3.', 'У випадках, не передбачених цим Договором, Сторони керуються чинним законодавством України.'),

      notes ? { text: `Примітка: ${notes}`, fontSize: 8.5, color: G2, italics: true, margin: [0, 10, 0, 0] } : {},

      // ═══ 10. РЕКВІЗИТИ ═══
      section('10', 'РЕКВІЗИТИ ТА ПІДПИСИ СТОРІН'),
      { text: '', margin: [0, 4] },
      {
        columns: [
          partyRequisites('ПОСТАЧАЛЬНИК', company, true),
          { width: 20, text: '' },
          partyRequisites('ПОКУПЕЦЬ', contractor, false),
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
      entity.phone ? { text: `Тел.: ${entity.phone}`, fontSize: 7.5, color: G2, margin: [0, 0, 0, 1] } : {},
      { text: '', margin: [0, 20] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: G3 }] },
      { text: `${position} ${director || ''}`.trim(), fontSize: 9, color: G1, margin: [0, 3, 0, 0] },
      { text: 'М.П.', fontSize: 6.5, color: G3, margin: [0, 5, 0, 0] },
    ],
  }
}

export function xlsx() { return null }
