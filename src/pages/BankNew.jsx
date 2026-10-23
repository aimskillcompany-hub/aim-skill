// «Банк і каса» в новому інтерфейсі (ТЗ редизайну 4.4; макети Bank / BankMobile).
// Завантаження, фільтри, прив'язка документів і збереження — з BankCash.jsx (TransactionsTab); тут подача:
//   операції по днях, чипи «Потребує уваги», підтвердження однієї операції кнопкою, напрям і стаття прямо в рядку,
//   масове редагування з липкою панеллю й «Скасувати» в тості, режим вибору довгим натисканням на телефоні.
import { useMemo, useRef, useState } from 'react'
import { Button, Menu, Segmented, EmptyState, TableSkeleton } from '../components/ui'
import { formatAmount } from '../utils/format'
import './BankNew.css'

const DAY = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })
const dayLabel = (iso) => DAY.format(new Date(iso + 'T00:00:00Z')).replace('.', '').toUpperCase()
const NO_DOC_OK = /податк|зарплат|банківськ|комісі|єсв|пдфо|військов/i
// документ не потрібен: ПФД, внутрішні операції, податки, зарплата, комісії банку
const docNotNeeded = (r) => r.direction === 'ПФД' || r.direction === 'Інше' || NO_DOC_OK.test(r.article || '')
export const issuesOf = (r) => ({
  noDoc: !(r._docs?.length) && !docNotNeeded(r),
  noArticle: !(r.article || '').trim(),
  noContractor: !r.contractor_id && !r.counterparty,
})
export const isReady = (r) => !r.is_validated && !!(r.contractor_id || r.counterparty) && !!r.direction && !!(r.article || '').trim() && ((r._docs?.length > 0) || docNotNeeded(r))

function TxIcon({ r }) {
  const k = r.direction === 'ПФД' || r.direction === 'Інше' ? 'swap' : Number(r.amount) >= 0 ? 'in' : 'out'
  const icon = { swap: 'ti-arrows-exchange', in: 'ti-arrow-up', out: 'ti-arrow-down' }[k]
  return <span className={`bkn-ico is-${k}`} aria-hidden="true"><i className={`ti ${icon}`} /></span>
}

export default function BankNew(p) {
  const { rows, loading, status, setStatus, q, setQ, acc, setAcc, accounts, art, setArt, grouped, typeLabels, directions,
    sel, toggleSel, setSel, onOpen, onLink, onAdd, autoLink, linking, linkMsg, autoFill, onCheck,
    quickUpdate, bulkUpdate, unignore, hasMore, onMore } = p
  const [issue, setIssue] = useState(null)       // noDoc | noArticle | noContractor — відбір серед завантажених
  const [bDir, setBDir] = useState('')
  const [bArt, setBArt] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const press = useRef(null)

  const issueCounts = useMemo(() => {
    const c = { noDoc: 0, noArticle: 0, noContractor: 0 }
    rows.forEach(r => { const i = issuesOf(r); Object.keys(c).forEach(k => { if (i[k]) c[k]++ }) })
    return c
  }, [rows])
  const list = useMemo(() => issue ? rows.filter(r => issuesOf(r)[issue]) : rows, [rows, issue])
  const days = useMemo(() => {
    const m = new Map()
    list.forEach(r => { const d = r.date || '—'; if (!m.has(d)) m.set(d, []); m.get(d).push(r) })
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [list])
  const ready = useMemo(() => list.filter(isReady), [list])
  const selSum = rows.filter(r => sel.has(r.id)).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const allOn = list.length > 0 && list.every(r => sel.has(r.id))
  const articleOptions = Object.entries(grouped).map(([type, arts]) => (
    <optgroup key={type} label={typeLabels[type] || type}>{arts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</optgroup>
  ))

  // довге натискання на телефоні — режим вибору
  const startPress = (id) => { press.current = setTimeout(() => { setSelectMode(true); if (!sel.has(id)) toggleSel(id) }, 500) }
  const endPress = () => clearTimeout(press.current)
  const ids = [...sel]
  const apply = (upd, label) => bulkUpdate(ids, upd, label).then(() => { setBDir(''); setBArt('') })

  return (
    <div className="bkn">
      <section className="bkn-card">
        <div className="bkn-toolbar">
          <Segmented ariaLabel="Стан операцій" value={status} onChange={setStatus}
            options={[{ value: 'unconfirmed', label: 'Непідтверджені' }, { value: 'all', label: 'Усі' }, { value: 'ignored', label: 'Ігноровані' }]} />
          <label className="bkn-search"><i className="ti ti-search" aria-hidden="true" />
            <input type="search" className="form-input" placeholder="Контрагент, ЄДРПОУ, призначення" aria-label="Пошук операцій" value={q} onChange={e => setQ(e.target.value)} /></label>
          <select className="form-input bkn-select" aria-label="Рахунок" value={acc} onChange={e => setAcc(e.target.value)}>
            <option value="all">Усі рахунки</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="form-input bkn-select" aria-label="Стаття" value={art} onChange={e => setArt(e.target.value)}>
            <option value="all">Усі статті</option><option value="__none__">Без статті</option>
            <option value="__nolink__">Стаття не з довідника</option><option value="__nocontractor__">Без контрагента</option>
            {articleOptions}
          </select>
          <Button variant="primary" icon="ti-link" onClick={autoLink} loading={linking} title="Прив'язати документи: контрагент + сума ±1% + дата ±15 днів">Автоприв'язка</Button>
          <Menu trigger={<Button variant="secondary" iconOnly icon="ti-dots" aria-label="Інші дії" />} items={[
            ...(status === 'unconfirmed' ? [{ label: 'Авто-класифікація видимих', icon: 'ti-wand', onClick: autoFill }] : []),
            { label: 'Перевірка прив\'язок', icon: 'ti-shield-check', onClick: onCheck },
            { label: 'Додати операцію', icon: 'ti-plus', onClick: onAdd },
          ]} />
        </div>

        {status !== 'ignored' && (issueCounts.noDoc + issueCounts.noArticle + issueCounts.noContractor > 0) && (
          <div className="bkn-issues" role="group" aria-label="Потребує уваги">
            <span className="bkn-issues-label">Потребує уваги</span>
            {[['noDoc', 'Без документа', 'is-warn'], ['noArticle', 'Без статті', 'is-exp'], ['noContractor', 'Без контрагента', 'is-danger']].map(([k, l, cls]) => issueCounts[k] > 0 && (
              <button key={k} type="button" className={`bkn-issue ${cls}`} aria-pressed={issue === k} onClick={() => setIssue(issue === k ? null : k)}>
                <span className="bkn-dot" aria-hidden="true" />{l}<b>{issueCounts[k]}</b>
              </button>
            ))}
            {issue && <button type="button" className="bkn-link" onClick={() => setIssue(null)}>Скинути</button>}
          </div>
        )}
        {linkMsg && <p className="bkn-msg" role="status">{linkMsg}</p>}

        {sel.size > 0 && (
          <div className="bkn-bulk" role="region" aria-label="Дії з вибраними">
            <b className="bkn-bulk-n">Вибрано {sel.size} · {formatAmount(selSum, { decimals: 0, sign: 'always' })} ₴</b>
            <label><span>Напрям</span><select value={bDir} onChange={e => setBDir(e.target.value)} aria-label="Напрям для вибраних">
              <option value="">не змінювати</option>{directions.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
            <label><span>Стаття</span><select value={bArt} onChange={e => setBArt(e.target.value)} aria-label="Стаття для вибраних">
              <option value="">не змінювати</option>{articleOptions}</select></label>
            <Button size="sm" variant="secondary" disabled={!bDir && !bArt} onClick={() => apply({ ...(bDir ? { direction: bDir } : {}), ...(bArt ? { article: bArt } : {}) }, 'Змінено')}>Застосувати до {sel.size}</Button>
            {status !== 'ignored' && <Button size="sm" variant="brand" icon="ti-check" onClick={() => apply({ is_validated: true }, 'Підтверджено')}>Підтвердити {sel.size}</Button>}
            {status !== 'ignored'
              ? <Button size="sm" variant="ghost" className="bkn-ignore" onClick={() => apply({ is_ignored: true }, 'Ігноровано')}>Ігнорувати</Button>
              : <Button size="sm" variant="ghost" className="bkn-ignore" onClick={() => apply({ is_ignored: false }, 'Повернуто в облік')}>Повернути в облік</Button>}
            <button type="button" className="bkn-bulk-cancel" onClick={() => { setSel(new Set()); setSelectMode(false) }}>Скасувати</button>
          </div>
        )}

        {!loading && list.length > 0 && status !== 'ignored' && (
          <div className="bkn-selectbar">
            <label className="bkn-check"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(list.map(r => r.id)))} /> Вибрати всі на екрані ({list.length})</label>
            {ready.length > 0 && <Button size="sm" variant="secondary" icon="ti-check" onClick={() => bulkUpdate(ready.map(r => r.id), { is_validated: true }, 'Підтверджено')}
              title="Готові: є контрагент, напрям, стаття і документ (або він не потрібен)">Підтвердити готові ({ready.length})</Button>}
            <span className="bkn-hint">готові = є контрагент, напрям, стаття і документ (або він не потрібен)</span>
            <button type="button" className="bkn-link bkn-mobile-only" onClick={() => setSelectMode(m => !m)}>{selectMode ? 'Готово' : 'Вибрати'}</button>
          </div>
        )}

        {loading ? <TableSkeleton rows={8} cols={3} label="Завантаження операцій…" />
          : list.length === 0 ? <EmptyState icon="ti-building-bank" title={issue || q ? 'Нічого не знайдено' : 'Операцій немає'}
              text={issue || q ? 'Змініть фільтр або пошук.' : status === 'unconfirmed' ? 'Усі операції підтверджено.' : 'Імпортуйте виписку або додайте операцію.'} />
          : <div className={`bkn-days${selectMode ? ' is-select' : ''}`}>
              {days.map(([d, items]) => {
                const net = items.reduce((s, r) => s + (Number(r.amount) || 0), 0)
                return (
                  <section key={d} className="bkn-day" aria-label={d}>
                    <div className="bkn-day-head"><span>{d === '—' ? 'Без дати' : dayLabel(d)}</span>
                      <b className={net >= 0 ? 'is-pos' : 'is-neg'}>{formatAmount(net, { decimals: 0, sign: 'always' })}</b></div>
                    {items.map(r => {
                      const i = issuesOf(r)
                      const name = r.counterparty || r.contractors?.name || r._cname
                      const on = sel.has(r.id)
                      return (
                        <div key={r.id} className={`bkn-row${on ? ' is-sel' : ''}${!r.is_validated && status !== 'ignored' ? ' is-unconfirmed' : ''}`}
                          onTouchStart={() => startPress(r.id)} onTouchEnd={endPress} onTouchMove={endPress}>
                          <input type="checkbox" className="bkn-cb" checked={on} onChange={() => toggleSel(r.id)} aria-label={`Вибрати операцію ${name || ''} ${formatAmount(r.amount)}`} />
                          <TxIcon r={r} />
                          <button type="button" className="bkn-main" onClick={() => selectMode ? toggleSel(r.id) : onOpen(r)}>
                            <span className={`bkn-name${name ? '' : ' is-none'}`}>{name || (/^Переказ (на|з) /.test(r.description || '') ? 'Внутрішній переказ' : 'Контрагента не вказано')}</span>
                            {r.description && <span className="bkn-desc">{r.description}</span>}
                            <span className="bkn-mobile-meta">{r.article || 'без статті'}
                              {i.noDoc && <span className="bkn-tag is-warn">Без документа</span>}
                              {i.noContractor && <span className="bkn-tag is-danger">Без контрагента</span>}</span>
                          </button>
                          <div className="bkn-chips">
                            <select className={`bkn-chip${r.direction ? '' : ' is-missing'}`} value={r.direction || ''} aria-label="Напрям"
                              onChange={e => quickUpdate(r, { direction: e.target.value || null })}>
                              <option value="">Напрям?</option>{directions.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <select className={`bkn-chip${r.article ? '' : ' is-missing'}`} value={r.article || ''} aria-label="Стаття"
                              onChange={e => quickUpdate(r, { article: e.target.value || null })}>
                              <option value="">{r.direction ? 'Стаття?' : 'Спершу напрям'}</option>{articleOptions}
                              {r.article && !Object.values(grouped).flat().some(a => a.name === r.article) && <option value={r.article}>{r.article}</option>}
                            </select>
                            {r._docs?.length
                              ? <button type="button" className="bkn-chip is-doc" onClick={() => onLink(r)} title="Прив'язані документи"><i className="ti ti-file-check" aria-hidden="true" />{r._docs.length > 1 ? `${r._docs.length} документи` : 'документ'}</button>
                              : !docNotNeeded(r) && <button type="button" className="bkn-chip is-add" onClick={() => onLink(r)}>+ документ</button>}
                          </div>
                          <div className="bkn-side">
                            <b className={`bkn-amt ${Number(r.amount) >= 0 ? 'is-pos' : 'is-neg'}`}>{formatAmount(r.amount, { decimals: Number(r.amount) % 1 ? 2 : 0, sign: 'always' })}</b>
                            {status === 'ignored'
                              ? <Button size="sm" variant="secondary" icon="ti-restore" onClick={() => unignore(r.id)}>Відновити</Button>
                              : r.is_validated
                                ? <span className="bkn-ok"><i className="ti ti-check" aria-hidden="true" />Підтверджено</span>
                                : <Button size="sm" variant="secondary" icon="ti-check" className="bkn-confirm" onClick={() => quickUpdate(r, { is_validated: true }, 'Підтверджено')}>Підтвердити</Button>}
                          </div>
                        </div>
                      )
                    })}
                  </section>
                )
              })}
            </div>}
        {hasMore && <div className="bkn-more"><Button variant="secondary" onClick={onMore}>Показати ще</Button></div>}
      </section>
      <button type="button" className="bkn-fab" onClick={onAdd} aria-label="Додати операцію"><i className="ti ti-plus" aria-hidden="true" /></button>
    </div>
  )
}
