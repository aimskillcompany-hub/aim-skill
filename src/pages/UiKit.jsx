// Еталон дизайн-системи: усі базові компоненти в усіх станах. Даних з бази не читає й нічого не зберігає.
// Доступ: у режимі розробки — без входу (#/ui), у робочій версії — лише адміністратор (див. App.jsx).
import { useState } from 'react'
import {
  Button, StatusPill, PropertyRow, PageHeader, Menu, ConfirmDialog, Modal, Segmented, Switch, EmptyState, TableSkeleton, useToast,
  ORDER_STATUS_TONE, TASK_STATUS_TONE, Tabs, KpiTile, HeroCard, Callout, Sheet, DataTable, BarMeter, StackBar,
} from '../components/ui'
import { formatMoney, formatDate, formatAmount } from '../utils/format'
import NewUiToggle from '../components/NewUiToggle'

// Приклади для демо (не реальні дані)
const DEMO_ROWS = [
  { id: 1, name: 'ТОВ «Приклад-1»', docs: 3, days: 42, debt: 184500 },
  { id: 2, name: 'КНП «Приклад-2»', docs: 1, days: 9, debt: 52300.5 },
  { id: 3, name: 'ФОП Приклад О. В.', docs: 2, days: 3, debt: 12800 },
]

const ORDER_CODES = ['new', 'tender', 'processing', 'needs_contract', 'ordering_supplier', 'shipped', 'needs_payment', 'paid', 'closed', 'won', 'lost']

function Section({ title, children }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title" style={{ marginBottom: 16 }}>{title}</h2>
      {children}
    </section>
  )
}
const Row = ({ children }) => <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>{children}</div>

export default function UiKit() {
  const toast = useToast()
  const [seg, setSeg] = useState('all')
  const [sw, setSw] = useState(true)
  const [modal, setModal] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [skeleton, setSkeleton] = useState(true)
 const [tab, setTab] = useState('receivables')
  const [sheet, setSheet] = useState(false)
  const fakeSave = () => { setLoading(true); setTimeout(() => { setLoading(false); toast('Збережено (демо, нічого не записано)') }, 900) }

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader crumbs={[{ label: 'Налаштування', to: '/settings' }, { label: 'Дизайн-система' }]} title="Дизайн-система"
        subtitle="Еталон компонентів. Дії на цій сторінці нічого не зберігають."
        primary={{ label: 'Головна дія', icon: 'ti-plus', onClick: () => toast('Головна дія') }}
        secondary={{ label: 'Другорядна', onClick: () => toast('Другорядна дія') }}
        menu={[
          { label: 'Дублювати', icon: 'ti-copy', onClick: () => toast('Дублювати') },
          { label: 'Експорт', icon: 'ti-download', disabled: true },
          { divider: true },
          { label: 'Видалити', icon: 'ti-trash', danger: true, confirm: { title: 'Видалити запис?', text: 'Це демо — нічого не видаляється.', confirmLabel: 'Видалити' }, onClick: () => toast('Видалено (демо)') },
        ]} />

      <Section title="Кнопки">
        <Row>
          <Button variant="primary" icon="ti-plus">Primary</Button>
          <Button variant="dark">Dark</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon="ti-trash">Danger</Button>
        </Row>
        <Row>
          <Button variant="primary" size="sm">Primary sm</Button>
          <Button variant="dark" size="sm">Dark sm</Button>
          <Button variant="secondary" size="sm">Secondary sm</Button>
          <Button variant="ghost" size="sm">Ghost sm</Button>
          <Button variant="danger" size="sm">Danger sm</Button>
        </Row>
        <Row>
          <Button variant="primary" loading={loading} onClick={fakeSave}>Зберегти</Button>
          <Button variant="secondary" disabled>Недоступна</Button>
          <Button variant="secondary" iconOnly icon="ti-pencil" aria-label="Редагувати" />
          <Button variant="ghost" iconOnly icon="ti-dots" aria-label="Інші дії" size="sm" />
        </Row>
      </Section>

      <Section title="Статуси замовлень">
        <Row>{ORDER_CODES.map(c => <StatusPill key={c} status={c} kind="order" />)}</Row>
        <p className="ui-muted" style={{ fontSize: 13 }}>
          Тони: {Object.entries(ORDER_STATUS_TONE).filter(([k]) => ORDER_CODES.includes(k)).map(([k, v]) => `${k} → ${v}`).join(', ')}
        </p>
      </Section>

      <Section title="Статуси задач">
        <Row>{Object.keys(TASK_STATUS_TONE).map(c => <StatusPill key={c} status={c} kind="task" />)}</Row>
        <Row><StatusPill status="new" kind="task" size="sm" /><StatusPill status="done" kind="task" size="sm" /><StatusPill status="xyz" kind="task" label="Невідомий → neutral" /></Row>
      </Section>

      <Section title="Властивості">
        <div style={{ maxWidth: 360 }}>
          <PropertyRow label="Статус"><StatusPill status="needs_payment" /></PropertyRow>
          <PropertyRow label="Сума" value={formatMoney(125430.5)} />
          <PropertyRow label="Термін" value={formatDate(new Date().toISOString(), { withWeekday: true })} onEdit={() => toast('Редагування поля')} />
          <PropertyRow label="Контрагент" value="ТОВ «Дуже довга назва контрагента без пробілів-ЯкаМаєПереноситисьНаНовийРядок»" onEdit={() => toast('Редагування поля')} />
          <PropertyRow label="Коментар" value="" />
        </div>
      </Section>

      <Section title="Перемикачі">
        <Row><Segmented ariaLabel="Фільтр" value={seg} onChange={setSeg} options={[{ value: 'all', label: 'Усі', count: 42 }, { value: 'open', label: 'Відкриті', count: 12 }, { value: 'done', label: 'Виконані' }]} /></Row>
        <Row><Segmented size="sm" ariaLabel="Вигляд" value={seg} onChange={setSeg} options={[{ value: 'all', label: 'Список', icon: 'ti-list' }, { value: 'open', label: 'Дошка', icon: 'ti-layout-kanban' }]} /></Row>
        <Row><Switch checked={sw} onChange={setSw} label="Показувати виконані" description="Виконані задачі згорнуто внизу списку" /></Row>
        <Row><Switch checked={false} disabled label="Недоступний перемикач" /></Row>
      </Section>

      <Section title="Меню і діалоги">
        <Row>
          <Menu trigger={<Button variant="secondary" icon="ti-dots">Дії</Button>} align="left" items={[
            { label: 'Змінити', icon: 'ti-pencil', onClick: () => toast('Змінити') },
            { label: 'Скасувати замовлення', icon: 'ti-ban', danger: true, confirm: true, onClick: () => toast('Скасовано (демо)') },
          ]} />
          <Button variant="secondary" onClick={() => setModal(true)}>Відкрити модальне вікно</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>Підтвердження</Button>
          <Button variant="secondary" onClick={() => toast('Не вдалося зберегти (демо)', { type: 'error' })}>Тост-помилка</Button>
        </Row>
      </Section>

      <Section title="Порожній стан і завантаження">
        <EmptyState icon="ti-clipboard-list" title="Задач немає" text="Створіть першу задачу або змініть фільтр." action={{ label: 'Створити задачу', icon: 'ti-plus', onClick: () => toast('Створити задачу') }} />
        <Row><Switch checked={skeleton} onChange={setSkeleton} label="Показати заглушку таблиці" /></Row>
        {skeleton && <TableSkeleton rows={4} cols={5} />}
      </Section>

      <Section title="Новий інтерфейс (етап 1)">
        <p className="ui-muted" style={{ fontSize: 13, marginBottom: 12 }}>Кнопки ink / brand, висота 42 px і радіуси 24 / 12 вмикаються перемикачем нижче (лише для вас).</p>
        <Row><NewUiToggle /></Row>
        <Row>
          <Button variant="primary">Primary (ink у новому)</Button>
          <Button variant="brand" icon="ti-check">Brand</Button>
          <Button variant="secondary">Secondary</Button>
        </Row>
        <Row><span className="ui-num">Форматер: {formatAmount(-1307205, { decimals: 0, currency: true })} · {formatAmount(911141, { decimals: 0, sign: 'always', currency: true })} · {formatAmount(24887553.5)}</span></Row>
      </Section>

      <Section title="Вкладки">
        <Tabs ariaLabel="Звіти (приклад)" idPrefix="demo-tab" value={tab} onChange={setTab} tabs={[
          { id: 'receivables', label: 'Дебіторка', count: 3 }, { id: 'payables', label: 'Кредиторка' },
          { id: 'profit', label: 'Прибутковість' }, { id: 'accountant', label: 'Для бухгалтера' }]} />
        <p className="ui-muted" style={{ fontSize: 13 }}>Обрано: {tab}. На телефоні вкладки стають чипами зі скролом.</p>
      </Section>

      <Section title="Головна цифра і KPI">
        <div style={{ display: 'grid', gap: 16 }}>
          <HeroCard label="Чистий потік · приклад" value={formatAmount(-125400, { decimals: 0 })} tone="neg"
            equation={[{ label: 'Надходження', value: formatAmount(840000, { decimals: 0 }) }, { op: '−', label: 'Витрати', value: formatAmount(965400, { decimals: 0 }) }, { op: '=', label: 'Чистий потік', value: formatAmount(-125400, { decimals: 0 }) }]} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <KpiTile label="Нам винні" value={formatAmount(249600, { decimals: 0, currency: true })} hint="3 боржники" onClick={() => toast('Перехід до дебіторки')} icon="ti-arrow-up-right" />
            <KpiTile label="30+ днів" value={formatAmount(184500, { decimals: 0, currency: true })} tone="warn" hint="варто перевірити" />
            <KpiTile label="Прострочено" value="2" tone="danger" hint="задачі" />
            <KpiTile label="Прибуток" value={formatAmount(96200, { decimals: 0, sign: 'always', currency: true })} tone="brand" />
          </div>
        </div>
      </Section>

      <Section title="Плашки">
        <div style={{ display: 'grid', gap: 10 }}>
          <Callout tone="info" title="Підказка." text="Суми з ПДВ, якщо не сказано інше." />
          <Callout tone="warn" title="12 операцій без статті." text="Звіт неточний, доки їх не розподілено." action={{ label: 'Розподілити', onClick: () => toast('Перехід до банку') }} />
          <Callout tone="danger" title="Мінусовий залишок." text="2 позиції на складі мають −1." action={{ label: 'Показати', onClick: () => toast('Фільтр складу') }} />
          <Callout tone="group" title="Операції всередині групи." text="Продажі між компаніями групи показано з чипом «група»." />
        </div>
      </Section>

      <Section title="Таблиця даних">
        <DataTable caption="Боржники (приклад)" rows={DEMO_ROWS}
          columns={[
            { key: 'name', label: 'Контрагент' },
            { key: 'docs', label: 'Документів', num: true, hideOnMobile: true },
            { key: 'days', label: 'Днів', num: true },
            { key: 'debt', label: 'Борг, з ПДВ', num: true, render: r => formatAmount(r.debt) },
          ]}
          totals={[{ name: 'Разом', docs: 6, days: '', debt: DEMO_ROWS.reduce((a, r) => a + r.debt, 0) }]}
          renderExpanded={r => <span className="ui-muted" style={{ fontSize: 13 }}>Документи контрагента «{r.name}» (приклад розкриття)</span>} />
      </Section>

      <Section title="Шкали">
        <div style={{ display: 'grid', gap: 16, maxWidth: 520 }}>
          <BarMeter label="Закупівля товарів" value={71} max={100} amount={formatAmount(1771601, { decimals: 0, currency: true })} tone="expense" />
          <BarMeter label="Виконання рішень" value={3} max={7} amount="3 з 7" />
          <StackBar ariaLabel="Вік боргу" segments={[
            { label: '0–7 днів', value: 12800, color: 'var(--brand)' },
            { label: '8–14', value: 52300, color: '#7FC3A5' },
            { label: '15–30', value: 0, color: '#E0A100' },
            { label: '30+', value: 184500, color: 'var(--expense-chart)' }]} />
        </div>
      </Section>

      <Section title="Шторка і сповіщення зі скасуванням">
        <Row>
          <Button variant="secondary" onClick={() => setSheet(true)}>Відкрити шторку</Button>
          <Button variant="secondary" onClick={() => toast('Змінено 12 операцій', { action: { label: 'Скасувати', onClick: () => toast('Скасовано (демо)') } })}>Тост «Скасувати»</Button>
        </Row>
      </Section>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Стаття для 12 операцій"
        footer={<><Button variant="secondary" onClick={() => setSheet(false)}>Скасувати</Button><Button variant="primary" onClick={() => { setSheet(false); toast('Застосовано (демо)') }}>Застосувати</Button></>}>
        <div className="form-group"><label className="form-label" htmlFor="demo-article">Стаття</label><select id="demo-article" className="form-input"><option>Закупівля товарів</option><option>Оренда</option></select></div>
      </Sheet>

      <Section title="Поля форми">
        <div className="form-grid" style={{ maxWidth: 560 }}>
          <div className="form-group"><label className="form-label">Назва</label><input className="form-input" placeholder="Введіть назву" /></div>
          <div className="form-group"><label className="form-label">Тип</label><select className="form-input"><option>Торгівля</option><option>Послуги</option></select></div>
        </div>
      </Section>

      <Modal open={modal} onClose={() => setModal(false)} title="Нове замовлення"
        footer={<><Button variant="secondary" onClick={() => setModal(false)}>Скасувати</Button><Button variant="dark" onClick={() => { setModal(false); toast('Створено (демо)') }}>Створити</Button></>}>
        <div className="form-group"><label className="form-label">Назва</label><input className="form-input" /></div>
        <div className="form-group"><label className="form-label">Сума</label><input className="form-input" inputMode="decimal" /></div>
      </Modal>
      <ConfirmDialog open={confirm} danger title="Видалити документ?" text={'Документ і його рухи буде видалено.\nЦе демо — нічого не видаляється.'} confirmLabel="Видалити"
        onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); toast('Видалено (демо)') }} />
    </div>
  )
}
