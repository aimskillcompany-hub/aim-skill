// Вкладка «Товари» в новому інтерфейсі (ТЗ редизайну 4.1; макет Order). Розрахунки, імпорт і збереження —
// з ItemsTab (OrderCard.jsx), тут лише подача й нова форма додавання позиції:
//   рядок інструментів «Ціни вводяться: з ПДВ / без ПДВ» · ПДВ · «Націнка на всі» · Дії · + Позиція;
//   у заголовках цін — «з ПДВ» / «без ПДВ», друга ціна — сірим під основною;
//   додавання: Товар → Кількість і ціни → Постачальник останнім кроком.
import { useMemo, useState } from 'react'
import ProductSelect from '../components/ui/ProductSelect'
import { Button, Menu, Segmented, Callout, EmptyState } from '../components/ui'
import { formatAmount } from '../utils/format'
import './ItemsNew.css'

const n = (v) => Number(v) || 0
const r2 = (v) => Math.round(v * 100) / 100

export default function ItemsNew(p) {
  const { rows, vatOn, defVat, suppliers, h, setRow, removeRow, addRowWith, setAllIncl, chooseSupplier, createSupplier,
    bulkMarkup, setBulkMarkup, applyBulkMarkup, totals, save, saving, saved, dirty, aiMsg, aiLoading, actions, onReport } = p
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState({})

  // «Ціни вводяться»: усі позиції в одному режимі; змішаний стан — жоден не обраний
  const inclAll = rows.length && rows.every(r => !!r.price_includes_vat)
  const exclAll = rows.length && rows.every(r => !r.price_includes_vat)
  const mode = rows.length === 0 ? (p.newIncl ? 'incl' : 'excl') : inclAll ? 'incl' : exclAll ? 'excl' : 'mixed'
  const tag = (incl) => vatOn ? <span className={`itn-tag${incl ? ' is-incl' : ''}`}>{incl ? 'з ПДВ' : 'без ПДВ'}</span> : null
  const headIncl = mode === 'incl'

  return (
    <div className="itn">
      <div className="itn-tools">
        {vatOn && <>
          <span className="itn-tools-label" id="itn-vat-mode">Ціни вводяться</span>
          <Segmented ariaLabel="Ціни вводяться" size="sm" value={mode === 'mixed' ? null : mode}
            onChange={(v) => setAllIncl(v === 'incl')}
            options={[{ value: 'incl', label: 'з ПДВ' }, { value: 'excl', label: 'без ПДВ' }]} />
          <span className="itn-vat-chip" title="Ставка ПДВ продажу за замовчуванням; окрема ставка — у «⋯» позиції">ПДВ {defVat}%</span>
        </>}
        <span className="itn-tools-spacer" />
        <label className="itn-markup">
          <span>Націнка на всі</span>
          <span className="itn-markup-field"><input className="form-input" type="number" inputMode="decimal" placeholder="0" aria-label="Націнка на всі позиції, %" value={bulkMarkup} onChange={e => setBulkMarkup(e.target.value)} /><span aria-hidden="true">%</span></span>
        </label>
        <Button size="sm" variant="secondary" onClick={applyBulkMarkup} disabled={bulkMarkup === ''}>Застосувати</Button>
        <Menu trigger={<Button size="sm" variant="secondary" icon="ti-dots" loading={aiLoading}>Імпорт</Button>} items={[
          { label: 'З таблиці (Excel / CSV)', icon: 'ti-table', onClick: actions.table },
          { label: 'З прайсу', icon: 'ti-tag', onClick: actions.price },
          { label: 'Специфікація (AI)', icon: 'ti-file-import', onClick: actions.spec },
          { label: 'Собівартість з рахунку (AI)', icon: 'ti-receipt-tax', onClick: actions.cost },
        ]} />
      </div>
      {vatOn && mode !== 'mixed' && <p className="itn-hint">{mode === 'incl' ? 'Закупка й продаж — з ПДВ; ціна без ПДВ рахується сама.' : 'Закупка й продаж — без ПДВ; ПДВ додається зверху.'}</p>}
      {vatOn && mode === 'mixed' && <p className="itn-hint is-warn">Частина позицій — з ПДВ, частина — без. Оберіть один режим: суми не зміняться, числа перерахуються.</p>}
      {aiMsg && <Callout tone="info" icon="ti-sparkles" text={aiMsg} />}

      {rows.length === 0 && !adding && (
        <EmptyState icon="ti-list-details" title="Позицій ще немає" text="Додайте товар з довідника, вручну або імпортом зі специфікації."
          action={{ label: 'Додати позицію', icon: 'ti-plus', onClick: () => setAdding(true) }} />
      )}

      {rows.length > 0 && (
        <div className="itn-table-wrap">
          <table className="itn-table">
            <thead><tr>
              <th>Позиція</th>
              <th className="r">К-сть</th>
              <th className="r">Закупка {tag(headIncl)}</th>
              <th className="r">Націнка</th>
              <th className="r">Ціна продажу {tag(headIncl)}</th>
              <th className="r">Сума {tag(true)}</th>
              <th className="r">Маржа {vatOn && <small>без ПДВ</small>}</th>
              <th aria-label="Дії" />
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const incl = !!r.price_includes_vat && vatOn
                const m = h.rowMargin(r), mp = h.marginPct(r)
                const isOpen = !!open[i]
                const noMarkup = !(n(r.cost_price) > 0 || n(r.unit_price) > 0)
                return (
                  <FragmentRow key={i}>
                    <tr className={isOpen ? 'is-open' : undefined}>
                      <td className="itn-name">
                        <span className="itn-no" aria-hidden="true">{i + 1}</span>
                        <div className="itn-name-body">
                          <ProductSelect className="itn-name-input" value={r.name} placeholder="Назва товару або артикул"
                            onChange={(name) => setRow(i, { name, product_id: null })}
                            onSelect={(x) => x._new ? setRow(i, { name: x.name, product_id: null })
                              : setRow(i, { name: x.name, product_id: x.id, sku: x.sku || r.sku || '', unit: x.unit || 'шт', cost_price: r.cost_price || x.buy_price || 0, unit_price: r.unit_price || x.sell_price || 0, price_includes_vat: false, supplier_id: null, supplier_name: null })} />
                          {r.characteristics && <span className="itn-chars">{r.characteristics}</span>}
                          <span className="itn-supplier"><i className="ti ti-truck-delivery" aria-hidden="true" />Постачальник:{' '}
                            <select aria-label={`Постачальник позиції ${i + 1}`} className={r.supplier_id ? '' : 'is-none'} value={r.supplier_id || ''} onChange={e => chooseSupplier(i, e.target.value)}>
                              <option value="">не вказано</option>
                              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              {r.supplier_id && !suppliers.some(s => s.id === r.supplier_id) && <option value={r.supplier_id}>{r.supplier_name || '—'}</option>}
                              <option value="__new__">＋ новий…</option>
                            </select>
                          </span>
                        </div>
                      </td>
                      <td className="r" data-label="Кількість"><input className="itn-cell" type="number" inputMode="decimal" aria-label={`Кількість, позиція ${i + 1}`} value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} /></td>
                      <td className="r" data-label={vatOn ? `Закупка, ${incl ? 'з ПДВ' : 'без ПДВ'}` : 'Закупка'}>
                        <input className="itn-cell" type="number" inputMode="decimal" aria-label={`Закупка, позиція ${i + 1}`} value={r.cost_price ?? ''} onChange={e => setRow(i, { cost_price: e.target.value })} />
                        {vatOn && <small className="itn-alt">{incl ? 'без ПДВ ' + formatAmount(h.netCost(r)) : 'з ПДВ ' + formatAmount(h.grossCost(r))}</small>}
                      </td>
                      <td className="r" data-label="Націнка"><span className="itn-markup-cell">
                        <input className="itn-cell is-markup" type="number" inputMode="decimal" placeholder="—" aria-label={`Націнка, %, позиція ${i + 1}`} value={h.fmtMarkup(r)} onChange={e => h.setMarkup(i, e.target.value)} disabled={noMarkup} /><span aria-hidden="true">%</span></span></td>
                      <td className="r" data-label={vatOn ? `Ціна продажу, ${incl ? 'з ПДВ' : 'без ПДВ'}` : 'Ціна продажу'}>
                        <input className="itn-cell is-strong" type="number" inputMode="decimal" aria-label={`Ціна продажу, позиція ${i + 1}`} value={r.unit_price} onChange={e => setRow(i, { unit_price: e.target.value })} />
                        {vatOn && <small className="itn-alt">{incl ? 'без ПДВ ' + formatAmount(h.netUnit(r)) : 'з ПДВ ' + formatAmount(h.grossUnit(r))}</small>}
                      </td>
                      <td className="r itn-num" data-label={vatOn ? 'Сума, з ПДВ' : 'Сума'}><b>{formatAmount(h.rowTotal(r))}</b>{vatOn && <small className="itn-alt">без ПДВ {formatAmount(h.rowNet(r))}</small>}</td>
                      <td className="r itn-num" data-label={vatOn ? 'Маржа, без ПДВ' : 'Маржа'}>
                        <span className={m < 0 ? 'is-neg' : 'is-pos'}>{formatAmount(m)}</span>
                        <span className="itn-mbar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, mp))}%` }} className={m < 0 ? 'is-neg' : ''} /></span>
                        <small className="itn-alt">{Math.round(mp)}%</small>
                      </td>
                      <td className="r itn-more-cell"><button type="button" className="itn-more" aria-expanded={isOpen} aria-label={`Ще про позицію ${i + 1}`} onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}>
                        <i className={`ti ${isOpen ? 'ti-chevron-up' : 'ti-dots'}`} aria-hidden="true" /></button></td>
                    </tr>
                    {isOpen && (
                      <tr className="itn-sub"><td colSpan={8}>
                        <div className="itn-sub-grid">
                          <label>Код / артикул<input className="form-input" value={r.sku || ''} onChange={e => setRow(i, { sku: e.target.value })} /></label>
                          <label>Од.<input className="form-input" value={r.unit || ''} onChange={e => setRow(i, { unit: e.target.value })} /></label>
                          {vatOn && <label>ПДВ продажу<select className="form-input" value={n(r.vat_rate)} onChange={e => setRow(i, { vat_rate: Number(e.target.value) })}>{[0, 20].map(v => <option key={v} value={v}>{v}%</option>)}</select></label>}
                          {vatOn && <label title="0% — постачальник-неплатник (ФОП)">ПДВ закупки<select className="form-input" value={r.cost_vat_rate === null || r.cost_vat_rate === undefined || r.cost_vat_rate === '' ? '' : String(n(r.cost_vat_rate))} onChange={e => setRow(i, { cost_vat_rate: e.target.value === '' ? null : Number(e.target.value) })}>
                            <option value="">як продаж</option>{[0, 20].map(v => <option key={v} value={String(v)}>{v}%</option>)}</select></label>}
                          <label className="is-wide">Характеристики (у КП дрібним під назвою)<textarea className="form-input" rows={2} value={r.characteristics || ''} onChange={e => setRow(i, { characteristics: e.target.value })} /></label>
                          <span className="itn-sub-actions">
                            {r.product_id && <span className="itn-linked"><i className="ti ti-link" aria-hidden="true" /> з довідника</span>}
                            <Button size="sm" variant="danger" icon="ti-trash" onClick={() => removeRow(i)}>Прибрати позицію</Button>
                          </span>
                        </div>
                      </td></tr>
                    )}
                  </FragmentRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding
        ? <AddItem no={rows.length + 1} vatOn={vatOn} defVat={defVat} incl={mode === 'mixed' ? true : (rows.length ? mode === 'incl' : !!p.newIncl)} suppliers={suppliers} usedSupplierIds={rows.map(r => r.supplier_id).filter(Boolean)}
            createSupplier={createSupplier} onCancel={() => setAdding(false)} onAdd={(row) => { addRowWith(row); setAdding(false) }} onPrice={actions.price} onImport={actions.table} />
        : rows.length > 0 && <div className="itn-add-row"><Button variant="secondary" icon="ti-plus" onClick={() => setAdding(true)}>Додати позицію</Button></div>}

      <div className="itn-save">
        {dirty && <span className="itn-dirty"><i className="ti ti-point-filled" aria-hidden="true" />Є незбережені зміни</span>}
        {saved && <span className="itn-saved" role="status">Збережено</span>}
        <span className="itn-tools-spacer" />
        {rows.length > 0 && <Button variant="secondary" icon="ti-chart-pie" onClick={onReport}>Розрахунок (PDF)</Button>}
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty && !saving}>Зберегти</Button>
      </div>
    </div>
  )
}

const FragmentRow = ({ children }) => <>{children}</>

// Нова позиція: Товар → Кількість і ціни → Постачальник останнім кроком (ТЗ 4.1)
function AddItem({ no, vatOn, defVat, incl, suppliers, usedSupplierIds, createSupplier, onCancel, onAdd, onPrice, onImport }) {
  const [src, setSrc] = useState('catalog')
  const [item, setItem] = useState({ name: '', product_id: null, sku: '', unit: 'шт', characteristics: '' })
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [markup, setMarkup] = useState('')
  const [price, setPrice] = useState('')
  const [sup, setSup] = useState(undefined)     // undefined — не обрано; null — без постачальника (зі складу)
  const [supSearch, setSupSearch] = useState('')
  const rate = vatOn ? defVat : 0
  const netOf = (v) => incl && rate ? v / (1 + rate / 100) : v
  const grossOf = (v) => incl || !rate ? v : v * (1 + rate / 100)

  const onCost = (v) => { setCost(v); if (markup !== '' && n(v) > 0) setPrice(String(r2(n(v) * (1 + n(markup) / 100)))) }
  const onMarkup = (v) => { setMarkup(v); if (n(cost) > 0 && v !== '') setPrice(String(r2(n(cost) * (1 + n(v) / 100)))) }
  const onPriceIn = (v) => { setPrice(v); if (n(cost) > 0 && n(v) > 0) setMarkup(String(r2((n(v) - n(cost)) / n(cost) * 100))) }

  const q = n(qty), sumNet = netOf(n(price)) * q, sumGross = grossOf(n(price)) * q, costNet = netOf(n(cost)) * q
  const margin = sumNet - costNet, mPct = sumNet > 0 ? margin / sumNet * 100 : 0
  const chips = useMemo(() => {
    const used = suppliers.filter(s => usedSupplierIds.includes(s.id))
    const rest = suppliers.filter(s => !usedSupplierIds.includes(s.id))
    return [...used, ...rest].slice(0, 4)
  }, [suppliers, usedSupplierIds])
  const found = supSearch.trim() ? suppliers.filter(s => (s.name || '').toLowerCase().includes(supSearch.trim().toLowerCase())).slice(0, 6) : []
  const ready = item.name.trim() && q > 0 && sup !== undefined
  const supName = sup ? (suppliers.find(s => s.id === sup)?.name || '') : null

  const add = () => onAdd({
    product_id: item.product_id, name: item.name.trim(), sku: item.sku || '', unit: item.unit || 'шт', characteristics: item.characteristics || null,
    qty: q, cost_price: n(cost), unit_price: n(price), vat_rate: vatOn ? defVat : 0, price_includes_vat: vatOn ? incl : false,
    supplier_id: sup || null, supplier_name: supName,
  })
  const newSupplier = async () => { const s = await createSupplier(supSearch.trim()); if (s) { setSup(s.id); setSupSearch('') } }

  return (
    <section className="itn-add" aria-label={`Нова позиція № ${no}`}>
      <div className="itn-add-head">
        <h3>Нова позиція № {no}</h3>
        <Segmented ariaLabel="Джерело позиції" size="sm" value={src} onChange={(v) => { if (v === 'price') { onPrice(); return } if (v === 'import') { onImport(); return } setSrc(v) }}
          options={[{ value: 'catalog', label: 'З довідника' }, { value: 'manual', label: 'Вручну' }, { value: 'price', label: 'З прайсу' }, { value: 'import', label: 'З Excel' }]} />
      </div>

      <div className="itn-step"><span className="itn-step-n">1</span><b>Товар</b></div>
      {src === 'catalog'
        ? <ProductSelect className="form-input itn-search" value={item.name} placeholder="Пошук у довіднику: назва, код, артикул"
            onChange={(name) => setItem(it => ({ ...it, name, product_id: null }))}
            onSelect={(x) => { setItem({ name: x.name, product_id: x._new ? null : x.id, sku: x.sku || '', unit: x.unit || 'шт', characteristics: '' }); if (!x._new && x.buy_price && !cost) onCost(String(x.buy_price)) }} />
        : <div className="itn-manual">
            <label>Назва<input className="form-input" value={item.name} onChange={e => setItem(it => ({ ...it, name: e.target.value, product_id: null }))} placeholder="Назва товару" /></label>
            <label>Код<input className="form-input" value={item.sku} onChange={e => setItem(it => ({ ...it, sku: e.target.value }))} /></label>
            <label>Од.<input className="form-input" value={item.unit} onChange={e => setItem(it => ({ ...it, unit: e.target.value }))} /></label>
          </div>}
      {src === 'catalog' && <p className="itn-note">Немає в довіднику? <button type="button" className="itn-link" onClick={() => setSrc('manual')}>Створити вручну</button> — товар збережеться в довідник.</p>}

      <div className="itn-step"><span className="itn-step-n">2</span><b>Кількість і ціна</b></div>
      <div className="itn-prices">
        <label>Кількість, {item.unit || 'шт'}<input className="form-input" type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>
        <label>Закупка{vatOn ? (incl ? ', з ПДВ' : ', без ПДВ') : ''}<input className="form-input" type="number" inputMode="decimal" value={cost} onChange={e => onCost(e.target.value)} /></label>
        <label>Націнка, %<input className="form-input" type="number" inputMode="decimal" value={markup} onChange={e => onMarkup(e.target.value)} /></label>
        <label>Ціна продажу{vatOn ? (incl ? ', з ПДВ' : ', без ПДВ') : ''}<input className="form-input is-sale" type="number" inputMode="decimal" value={price} onChange={e => onPriceIn(e.target.value)} /></label>
      </div>
      <p className="itn-note">Ціна продажу = закупка × (1 + націнка). Змініть націнку — ціна перерахується; ціну можна ввести і напряму.</p>
      <div className="itn-live">
        {vatOn && <div><span>Сума без ПДВ</span><b>{formatAmount(sumNet)}</b></div>}
        {vatOn && <div><span>ПДВ {rate}%</span><b>{formatAmount(sumGross - sumNet)}</b></div>}
        <div><span>{vatOn ? 'Сума з ПДВ' : 'Сума'}</span><b>{formatAmount(sumGross)}</b></div>
        <div><span>Маржа{vatOn ? ' без ПДВ' : ''}</span><b className={margin < 0 ? 'is-neg' : 'is-pos'}>{formatAmount(margin)} · {Math.round(mPct)}%</b></div>
      </div>

      <div className={`itn-supplier-step${sup === undefined ? ' is-required' : ''}`}>
        <div className="itn-step"><span className="itn-step-n">3</span><b>Постачальник</b>{sup === undefined && <span className="itn-req" aria-hidden="true">*</span>}</div>
        <div className="itn-chips" role="group" aria-label="Постачальник">
          {chips.map(s => <button key={s.id} type="button" className="itn-chip" aria-pressed={sup === s.id} onClick={() => setSup(s.id)}>{s.name}</button>)}
          {sup && !chips.some(c => c.id === sup) && <button type="button" className="itn-chip" aria-pressed="true">{supName}</button>}
          <button type="button" className="itn-chip" aria-pressed={sup === null} onClick={() => setSup(null)}>Зі складу / без постачальника</button>
          <label className="itn-chip-search"><i className="ti ti-search" aria-hidden="true" />
            <input value={supSearch} onChange={e => setSupSearch(e.target.value)} placeholder="Інший постачальник або + новий" aria-label="Пошук постачальника" /></label>
        </div>
        {supSearch.trim() && (
          <div className="itn-found">
            {found.map(s => <button key={s.id} type="button" onClick={() => { setSup(s.id); setSupSearch('') }}>{s.name}</button>)}
            <button type="button" className="is-new" onClick={newSupplier}>＋ Новий постачальник «{supSearch.trim()}»</button>
          </div>
        )}
        {sup === undefined && <p className="itn-note is-warn">Останній крок: оберіть, у кого закуповуємо, — після цього позицію можна додати.</p>}
      </div>

      <div className="itn-add-foot">
        <Button variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button variant="primary" onClick={add} disabled={!ready}>{!item.name.trim() ? 'Оберіть товар' : sup === undefined ? 'Оберіть постачальника' : 'Додати позицію'}</Button>
      </div>
    </section>
  )
}
