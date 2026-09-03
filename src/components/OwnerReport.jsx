import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtInt } from '../lib/fmt'

// Звіт власника («Розрахунок») — по-замовленнєвий прибуток + агентські, ПО ВСІХ КОМПАНІЯХ.
// Навмисно БЕЗ company-scope (крос-компанійний): запити напряму через supabase.
// Групування по клієнту (як в Excel), у кожному рядку — колонка «Компанія» (наша юрособа).
// Формули (звірено з Excel власника):
//   маржа = реалізація(net) − закупка(net)
//   ПДВ до сплати = маржа × ставкаПДВ   (лише для ТОВ-платника ПДВ; ФОП/неплатник = 0)
//   податок на прибуток = маржа × ставкаПодатку   (лише для платника ПДВ; інакше 0)
//   чистий прибуток = маржа − податок
//   агентські = чистий × %агентських (поле замовлення)

const d = (x) => {
  if (!x) return ''
  const s = String(x).slice(0, 10); const [y, m, day] = s.split('-')
  return y && m && day ? `${day}.${m}.${y}` : s
}
// Ціна/собівартість → net (без ПДВ), з урахуванням price_includes_vat позиції
const netUnit = (price, vat, incl) => { const p = +price || 0, v = +vat || 0; return incl ? (v > 0 ? p / (1 + v / 100) : p) : p }

async function chunkedIn(table, cols, col, ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from(table).select(cols).in(col, ids.slice(i, i + 300))
    if (data) out.push(...data)
  }
  return out
}

export default function OwnerReport() {
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [vatRate, setVatRate] = useState(20)
  const [taxRate, setTaxRate] = useState(18)
  const [showUnpaid, setShowUnpaid] = useState(true)
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  async function generate() {
    setLoading(true); setErr(null)
    try {
      const [{ data: ords, error: oErr }, { data: comps }] = await Promise.all([
        supabase.from('orders')
          .select('id, order_number, created_at, client_id, company_id, agent_commission_pct, contractors(name)')
          .is('archived_at', null).order('order_number'),
        supabase.from('companies').select('id, short_name, name, is_vat_payer'),
      ])
      if (oErr) throw oErr
      const compById = {}; (comps || []).forEach(c => { compById[c.id] = c })
      const ids = (ords || []).map(o => o.id)

      // Позиції + ланцюг оплати (документи → transaction_documents → банк)
      const items = ids.length ? await chunkedIn('order_items', 'order_id, qty, unit_price, cost_price, vat_rate, price_includes_vat', 'order_id', ids) : []
      const docs = ids.length ? await chunkedIn('documents', 'id, order_id', 'order_id', ids) : []
      const docIds = docs.map(x => x.id)
      const docToOrder = {}; docs.forEach(x => { docToOrder[x.id] = x.order_id })
      const tds = docIds.length ? await chunkedIn('transaction_documents', 'transaction_id, document_id', 'document_id', docIds) : []
      const txIds = [...new Set(tds.map(t => t.transaction_id))]
      const txs = txIds.length ? await chunkedIn('bank_transactions', 'id, date, direction, is_ignored', 'id', txIds) : []
      const txById = {}; txs.forEach(t => { txById[t.id] = t })
      // order_id → найраніша дата вхідної (оплата від клієнта)
      const paidByOrder = {}
      tds.forEach(t => {
        const tx = txById[t.transaction_id]; if (!tx || tx.is_ignored) return
        if (tx.direction !== 'Доходи') return
        const oid = docToOrder[t.document_id]; if (!oid) return
        if (!paidByOrder[oid] || tx.date < paidByOrder[oid]) paidByOrder[oid] = String(tx.date).slice(0, 10)
      })

      // Позиції по замовленню → net-суми
      const byOrder = {}
      items.forEach(it => {
        const o = (byOrder[it.order_id] ||= { rev: 0, cost: 0 })
        const q = +it.qty || 0
        o.rev += netUnit(it.unit_price, it.vat_rate, it.price_includes_vat) * q
        o.cost += netUnit(it.cost_price, it.vat_rate, it.price_includes_vat) * q
      })

      const vr = (Number(vatRate) || 0) / 100, tr = (Number(taxRate) || 0) / 100
      const result = []
      for (const o of (ords || [])) {
        const agg = byOrder[o.id] || { rev: 0, cost: 0 }
        if (agg.rev === 0 && agg.cost === 0) continue // порожні замовлення пропускаємо (як в Excel)
        const comp = compById[o.company_id] || {}
        const vatPayer = comp.is_vat_payer !== false
        const paid = paidByOrder[o.id] || null
        const refDate = paid || (o.created_at || '').slice(0, 10)
        if (from && refDate < from) continue
        if (to && refDate > to) continue
        if (!paid && !showUnpaid) continue
        const margin = agg.rev - agg.cost
        const vat = vatPayer ? margin * vr : 0
        const tax = vatPayer ? margin * tr : 0
        const net = margin - tax
        const pct = +o.agent_commission_pct || 0
        result.push({
          id: o.id, number: o.order_number || o.id.slice(0, 6),
          client: o.contractors?.name || '— без клієнта —', clientId: o.client_id || '_none',
          company: comp.short_name || comp.name || '—',
          paid, cost: agg.cost, rev: agg.rev, vat, tax, net, pct, agent: net * pct,
        })
      }
      setRows(result)
    } catch (e) {
      setErr(e.message || 'Помилка формування'); setRows([])
    } finally { setLoading(false) }
  }

  // Групування по клієнту + підсумки
  const groups = useMemo(() => {
    if (!rows) return null
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.clientId)) map.set(r.clientId, { client: r.client, rows: [] })
      map.get(r.clientId).rows.push(r)
    }
    const arr = [...map.values()].sort((a, b) => a.client.localeCompare(b.client, 'uk'))
    arr.forEach(g => { g.sum = sumRows(g.rows) })
    return arr
  }, [rows])
  const grand = useMemo(() => rows ? sumRows(rows) : null, [rows])

  // Інлайн-правка % агентських (крос-компанійний update)
  const setPct = async (id, val) => {
    const pct = Math.max(0, (Number(val) || 0)) / 100
    setRows(rs => rs.map(r => r.id === id ? { ...r, pct, agent: r.net * pct } : r))
    const { error } = await supabase.from('orders').update({ agent_commission_pct: pct }).eq('id', id)
    if (error) alert('Не вдалося зберегти %: ' + (/agent_commission_pct/.test(error.message) ? 'запустіть міграцію 046' : error.message))
  }

  async function exportXlsx() {
    if (!rows?.length) return
    const XLSX = await import('xlsx')
    const head = ['Клієнт', 'Компанія', 'Замовлення №', 'Дата оплати', 'Закупка без ПДВ', 'Реалізація без ПДВ', 'ПДВ до сплати', 'Податок на прибуток', 'Чистий прибуток', '% агент.', 'Сума агентських']
    const body = []
    for (const g of groups) {
      g.rows.forEach(r => body.push([g.client, r.company, r.number, r.paid || 'не оплачено', r.cost, r.rev, r.vat, r.tax, r.net, r.pct, r.agent]))
      body.push([`РАЗОМ ${g.client}`, '', '', '', g.sum.cost, g.sum.rev, g.sum.vat, g.sum.tax, g.sum.net, '', g.sum.agent])
    }
    body.push(['ВСЬОГО', '', '', '', grand.cost, grand.rev, grand.vat, grand.tax, grand.net, '', grand.agent])
    const ws = XLSX.utils.aoa_to_sheet([head, ...body])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Розрахунок')
    XLSX.writeFile(wb, `Розрахунок_${from}_${to}.xlsx`)
  }

  const Num = ({ v, bold, color }) => <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: bold ? 700 : 400, color }}>{fmt(v)}</td>

  return (
    <div>
      {/* Фільтри */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0 }}><label>Період з</label><input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="form-group" style={{ margin: 0 }}><label>по</label><input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="form-group" style={{ margin: 0, width: 92 }}><label>ПДВ %</label><input className="form-input" type="number" value={vatRate} onChange={e => setVatRate(e.target.value)} /></div>
          <div className="form-group" style={{ margin: 0, width: 110 }}><label>Податок %</label><input className="form-input" type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', paddingBottom: 10 }}>
            <input type="checkbox" checked={showUnpaid} onChange={e => setShowUnpaid(e.target.checked)} style={{ width: 16, height: 16 }} /> Показувати неоплачені
          </label>
          <button className="btn btn-primary" onClick={generate} disabled={loading}>{loading ? 'Формування…' : <><i className="ti ti-calculator" /> Сформувати</>}</button>
          {rows?.length > 0 && <button className="btn" onClick={exportXlsx}><i className="ti ti-file-spreadsheet" /> Excel</button>}
        </div>
      </div>

      {err && <div className="card" style={{ marginBottom: 16, color: 'var(--red)' }}>{err}</div>}

      {grand && (
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <Kpi label="Закупка (без ПДВ)" value={grand.cost} color="var(--red)" />
          <Kpi label="Реалізація (без ПДВ)" value={grand.rev} color="var(--green)" />
          <Kpi label="Чистий прибуток" value={grand.net} color={grand.net >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Kpi label="Агентські" value={grand.agent} />
        </div>
      )}

      {groups && (
        <div className="card">
          <div className="tbl-wrap" style={{ border: 'none', overflowX: 'auto' }}>
            <table style={{ minWidth: 980 }}>
              <thead><tr>
                <th>Замовлення</th><th>Компанія</th><th>Дата оплати</th>
                <th style={{ textAlign: 'right' }}>Закупка</th><th style={{ textAlign: 'right' }}>Реалізація</th>
                <th style={{ textAlign: 'right' }}>ПДВ</th><th style={{ textAlign: 'right' }}>Податок</th>
                <th style={{ textAlign: 'right' }}>Чистий</th><th style={{ textAlign: 'right', width: 70 }}>% агент.</th><th style={{ textAlign: 'right' }}>Агентські</th>
              </tr></thead>
              <tbody>
                {groups.map(g => (
                  <Fragmentish key={g.client}>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td colSpan={10} style={{ fontWeight: 700, color: 'var(--text)' }}>{g.client}</td>
                    </tr>
                    {g.rows.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 500 }}>{r.number}</td>
                        <td style={{ fontSize: 13, color: 'var(--text2)' }}><div className="trunc">{r.company}</div></td>
                        <td style={{ whiteSpace: 'nowrap', color: r.paid ? 'var(--text2)' : 'var(--text3)', fontSize: 13 }}>{r.paid ? d(r.paid) : 'не оплачено'}</td>
                        <Num v={r.cost} /><Num v={r.rev} />
                        <Num v={r.vat} color="var(--text3)" /><Num v={r.tax} color="var(--text3)" />
                        <Num v={r.net} bold color={r.net >= 0 ? 'var(--green)' : 'var(--red)'} />
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" value={Math.round(r.pct * 100 * 100) / 100} onChange={e => setPct(r.id, e.target.value)}
                            style={{ width: 52, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 4px', fontSize: 12.5, fontFamily: 'inherit' }} />
                        </td>
                        <Num v={r.agent} />
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text2)', fontSize: 12.5 }}>Разом {g.client}</td>
                      <Num v={g.sum.cost} bold /><Num v={g.sum.rev} bold />
                      <Num v={g.sum.vat} bold color="var(--text3)" /><Num v={g.sum.tax} bold color="var(--text3)" />
                      <Num v={g.sum.net} bold /><td /><Num v={g.sum.agent} bold />
                    </tr>
                  </Fragmentish>
                ))}
                {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text3)', padding: 28 }}>За вибіркою немає замовлень з позиціями</td></tr>}
              </tbody>
              {rows.length > 0 && (
                <tfoot><tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <td colSpan={3} style={{ textAlign: 'right' }}>ВСЬОГО</td>
                  <Num v={grand.cost} bold /><Num v={grand.rev} bold />
                  <Num v={grand.vat} bold color="var(--text3)" /><Num v={grand.tax} bold color="var(--text3)" />
                  <Num v={grand.net} bold color={grand.net >= 0 ? 'var(--green)' : 'var(--red)'} /><td /><Num v={grand.agent} bold />
                </tr></tfoot>
              )}
            </table>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
            Закупка/реалізація — з позицій замовлення (без ПДВ). ПДВ і податок нараховуються лише для компаній-платників ПДВ.
            «Дата оплати» — за прив'язаною банківською оплатою; фільтр періоду: оплачені — за датою оплати, неоплачені — за датою замовлення.
          </p>
        </div>
      )}
    </div>
  )
}

function sumRows(rows) {
  return rows.reduce((s, r) => ({
    cost: s.cost + r.cost, rev: s.rev + r.rev, vat: s.vat + r.vat, tax: s.tax + r.tax, net: s.net + r.net, agent: s.agent + r.agent,
  }), { cost: 0, rev: 0, vat: 0, tax: 0, net: 0, agent: 0 })
}
function Fragmentish({ children }) { return children }
function Kpi({ label, value, color }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{fmtInt(value)} <span style={{ fontSize: 14, color: 'var(--text3)' }}>грн</span></div>
    </div>
  )
}
