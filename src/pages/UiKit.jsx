// Еталон дизайн-системи: усі базові компоненти в усіх станах. Даних з бази не читає й нічого не зберігає.
// Доступ: у режимі розробки — без входу (#/ui), у робочій версії — лише адміністратор (див. App.jsx).
import { useState } from 'react'
import {
  Button, StatusPill, PropertyRow, PageHeader, Menu, ConfirmDialog, Modal, Segmented, Switch, EmptyState, TableSkeleton, useToast,
  ORDER_STATUS_TONE, TASK_STATUS_TONE,
} from '../components/ui'
import { formatMoney, formatDate } from '../utils/format'

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
