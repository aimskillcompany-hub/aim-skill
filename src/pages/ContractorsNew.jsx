// Довідник контрагентів у новому інтерфейсі (ТЗ редизайну 4.3; макети Contractors / ContractorsMobile).
// Дані (довідник, обороти з банку) — з Contractors.jsx. «Нам винні» — той самий розрахунок, що у звіті
// «Дебіторка» (lib/receivables), станом на сьогодні. Лише читання.
import { useEffect, useMemo, useState } from 'react'
import { useGroupContractors } from '../lib/group'
import { Segmented, Button, KpiTile, EmptyState, TableSkeleton } from '../components/ui'
import { formatAmount, plural } from '../utils/format'
import { todayKyiv } from '../lib/dates'
import { loadReceivablesAsOf, groupReceivables } from '../lib/receivables'
import { initials } from '../components/AppShell'
import './ContractorsNew.css'

const PAGE = 50
const fmtD = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : ''
// «10 дн. тому» / «4 міс. тому» / «понад рік тому»; давнє (> 6 міс.) — червоним
function ago(iso) {
  if (!iso) return null
  const days = Math.round((Date.parse(todayKyiv()) - Date.parse(String(iso).slice(0, 10))) / 864e5)
  if (days <= 0) return { label: 'сьогодні', old: false }
  if (days < 31) return { label: `${days} дн. тому`, old: false }
  const m = Math.round(days / 30.4)
  if (m < 12) return { label: `${m} міс. тому`, old: m > 6 }
  return { label: 'понад рік тому', old: true }
}
const typeOf = (c) => c.is_client && c.is_supplier ? 'both' : c.is_client ? 'client' : c.is_supplier ? 'supplier' : 'none'

export default function ContractorsNew({ list, loading, q, setQ, filter, setFilter, companies, onNew, navigate }) {
  const grp = useGroupContractors()
  const [sortKey, setSortKey] = useState('turnover')
  const [shown, setShown] = useState(PAGE)
  const [debt, setDebt] = useState(null)   // { total, byId }
  useEffect(() => {
    if (!companies?.length) return
    let alive = true
    loadReceivablesAsOf(companies, todayKyiv()).then(({ docs }) => {
      if (!alive) return
      const g = groupReceivables(docs)
      setDebt({ total: g.summary.total, byId: Object.fromEntries(g.contractors.map(c => [c.contractorId, c.total])) })
    }).catch(() => alive && setDebt({ total: null, byId: {} }))
    return () => { alive = false }
  }, [companies])
  useEffect(() => { setShown(PAGE) }, [q, filter, sortKey])

  const ownEdrpou = useMemo(() => new Set((companies || []).map(c => c.edrpou).filter(Boolean)), [companies])
  const counts = useMemo(() => ({
    all: list.length, client: list.filter(c => c.is_client).length, supplier: list.filter(c => c.is_supplier).length,
    none: list.filter(c => !c.is_client && !c.is_supplier).length,
  }), [list])
  const term = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const r = list.filter(c => {
      if (filter === 'client' && !c.is_client) return false
      if (filter === 'supplier' && !c.is_supplier) return false
      if (filter === 'none' && (c.is_client || c.is_supplier)) return false
      return !term || (c.name || '').toLowerCase().includes(term) || (c.short_name || '').toLowerCase().includes(term) || (c.edrpou || '').includes(term)
    })
    const key = {
      turnover: c => (Number(c.total_income) || 0) + (Number(c.total_expense) || 0),
      last: c => c.last_operation_date || '',
      name: c => (c.name || '').toLowerCase(),
      debt: c => debt?.byId?.[c.id] || 0,
    }[sortKey]
    return [...r].sort((a, b) => {
      const x = key(a), y = key(b)
      if (sortKey === 'name') return x.localeCompare(y, 'uk')
      return x < y ? 1 : x > y ? -1 : 0
    })
  }, [list, filter, term, sortKey, debt])
  const view = rows.slice(0, shown)

  const typeChip = (c) => {
    const t = typeOf(c)
    return t === 'none' ? <span className="ctn-type is-none">Вказати тип</span>
      : <span className="ctn-types">{c.is_client && <span className="ctn-type is-client">Клієнт</span>}{c.is_supplier && <span className="ctn-type is-supplier">Постачальник</span>}</span>
  }
  const edr = (c) => (
    <span className="ctn-edr">ЄДРПОУ {c.edrpou || '—'}
      {c.edrpou && /^0+$/.test(c.edrpou) && <b className="is-warn"> · перевірте код</b>}
      {c.edrpou && ownEdrpou.has(c.edrpou) && <b className="is-own"> · ваша компанія</b>}
    </span>
  )

  return (
    <div className="ctn">
      <div className="ctn-head">
        <div>
          <h1 className="ctn-h1">Контрагенти</h1>
          <p className="ctn-sub">{counts.all} у довіднику · {counts.client} клієнтів · {counts.supplier} постачальників</p>
        </div>
        <Button variant="brand" icon="ti-plus" onClick={onNew} className="ctn-new">Новий контрагент</Button>
      </div>

      <div className="ctn-kpis">
        <KpiTile label="Нам винні (дебіторка)" tone="brand"
          value={debt == null ? '…' : debt.total == null ? '—' : `${formatAmount(debt.total, { decimals: 0 })} ₴`}
          hint={debt?.total != null ? 'за всіма клієнтами, як у звіті «Дебіторка»' : 'рахується…'}
          onClick={() => navigate('/reports?tab=receivables')} />
        <KpiTile label="Ми винні (кредиторка)" value="—" hint="з'явиться разом зі звітом «Кредиторка»" onClick={() => navigate('/reports?tab=payables')} />
        {counts.none > 0 && <KpiTile label="Без типу" tone="warn" value={`${counts.none} ${plural(counts.none, ['контрагент', 'контрагенти', 'контрагентів'])}`} hint="вкажіть, клієнт це чи постачальник →" onClick={() => setFilter('none')} />}
      </div>

      <section className="ctn-card">
        <div className="ctn-toolbar">
          <Segmented ariaLabel="Тип контрагента" value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'Усі', count: counts.all }, { value: 'client', label: 'Клієнти', count: counts.client },
            { value: 'supplier', label: 'Постачальники', count: counts.supplier }, ...(counts.none ? [{ value: 'none', label: 'Без типу', count: counts.none }] : []),
          ]} />
          <label className="ctn-search"><i className="ti ti-search" aria-hidden="true" />
            <input type="search" className="form-input" placeholder="Назва або ЄДРПОУ" aria-label="Пошук контрагентів" value={q} onChange={e => setQ(e.target.value)} /></label>
          <select className="form-input ctn-sort" aria-label="Сортування" value={sortKey} onChange={e => setSortKey(e.target.value)}>
            <option value="turnover">Сортування: оборот</option>
            <option value="debt">Сортування: борг</option>
            <option value="last">Сортування: остання операція</option>
            <option value="name">Сортування: назва</option>
          </select>
        </div>

        {loading ? <TableSkeleton rows={8} cols={5} label="Завантаження контрагентів…" />
          : rows.length === 0 ? <EmptyState icon="ti-search" title="Нічого не знайдено" text="Змініть пошук або фільтр."
              action={{ label: 'Скинути', onClick: () => { setQ(''); setFilter('all') } }} />
          : <>
            <div className="ctn-table-wrap">
              <table className="ctn-table">
                <thead><tr><th>Контрагент</th><th>Тип</th><th className="r">Дохід</th><th className="r">Витрати</th><th className="r">Операцій</th><th className="r">Остання</th></tr></thead>
                <tbody>
                  {view.map(c => {
                    const a = ago(c.last_operation_date)
                    return (
                      <tr key={c.id} onClick={() => navigate(`/contractors/${c.id}`)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') navigate(`/contractors/${c.id}`) }}>
                        <td><span className="ctn-name"><span className={`ctn-av is-${typeOf(c)}`} aria-hidden="true">{initials(c.short_name || c.name)}</span>
                          <span className="ctn-name-text"><b>{c.name}{grp.has(c.id) && <span className="grp-chip">група</span>}</b>{edr(c)}</span></span></td>
                        <td>{typeChip(c)}</td>
                        <td className="r ctn-in">{Number(c.total_income) > 0 ? formatAmount(c.total_income, { decimals: 0 }) : <span className="ctn-dash">—</span>}</td>
                        <td className="r ctn-out">{Number(c.total_expense) > 0 ? formatAmount(c.total_expense, { decimals: 0 }) : <span className="ctn-dash">—</span>}</td>
                        <td className="r ctn-ops">{c.operations_count || 0}</td>
                        <td className="r">{c.last_operation_date ? <span className="ctn-last">{fmtD(c.last_operation_date)}<small className={a?.old ? 'is-old' : ''}>{a?.label}</small></span> : <span className="ctn-dash">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ul className="ctn-cards">
              {view.map(c => (
                <li key={c.id}><button type="button" className="ctn-mcard" onClick={() => navigate(`/contractors/${c.id}`)}>
                  <span className={`ctn-av is-${typeOf(c)}`} aria-hidden="true">{initials(c.short_name || c.name)}</span>
                  <span className="ctn-mcard-body"><b>{c.name}{grp.has(c.id) && <span className="grp-chip">група</span>}</b>{edr(c)}
                    <span className="ctn-mcard-foot">{typeChip(c)}
                      {Number(c.total_income) > 0 && <span className="ctn-in">+{formatAmount(c.total_income, { decimals: 0 })}</span>}
                      {Number(c.total_expense) > 0 && <span className="ctn-out">−{formatAmount(c.total_expense, { decimals: 0 })}</span>}
                      {debt?.byId?.[c.id] > 0 && <span className="ctn-wait">чекає оплату</span>}
                    </span>
                  </span>
                  <i className="ti ti-chevron-right" aria-hidden="true" />
                </button></li>
              ))}
            </ul>
            <div className="ctn-foot">
              <span>Показано {view.length} із {rows.length}</span>
              {view.length < rows.length && <Button variant="secondary" onClick={() => setShown(s => s + PAGE)}>Показати ще</Button>}
            </div>
          </>}
      </section>
      <button type="button" className="ctn-fab" onClick={onNew} aria-label="Новий контрагент"><i className="ti ti-plus" aria-hidden="true" /></button>
    </div>
  )
}
