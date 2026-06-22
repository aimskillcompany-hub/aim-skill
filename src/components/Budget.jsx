import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, PL_ORDER, PL_LABELS, PL_SIGN } from '../lib/articles'
import { fmtInt as fmt } from '../lib/fmt'

// Об'єднана вкладка «Бюджет і прогноз»:
//  • зверху — редагований план P&L (статті по pl_level × місяці), пише в plans
//  • знизу  — грошовий прогноз, що оновлюється НАЖИВО з введеного плану
// Прибуток (P&L) і гроші (залишок) — різні величини, тому це дві окремі таблиці.

const MONTH_SHORT = ['Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру']
const MONTH_FULL = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
const CASH_DIR = { income: 1, expense: -1, advance: -1, advance_return: 1, bank_to_cash: 1, cash_to_bank: -1 }
const FC_MONTHS = 6 // горизонт грошового прогнозу

const fmtS = n => n === 0 ? '—' : (n > 0 ? '+' : '−') + fmt(n)
const numColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)'

// "Плоский" запис — той, яким керує грід (без додаткових атрибутів)
const isPlainRow = (p) => !p.is_template && !p.contractor && !p.project_id && !p.description

function getMonthRange(from, to) {
  const out = []
  let [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (fy < ty || (fy === ty && fm <= tm)) {
    out.push(`${fy}-${String(fm).padStart(2, '0')}`)
    fm++; if (fm > 12) { fm = 1; fy++ }
  }
  return out
}
// Розгорнути шаблон у конкретні місяці (опціонально лише для одного року)
function expandTemplate(p, onlyYear) {
  if (!p.is_template || !p.template_from || !p.template_to) return []
  return getMonthRange(p.template_from, p.template_to).filter(m => onlyYear == null || m.startsWith(String(onlyYear)))
}

export default function Budget({ user }) {
  const [articles, setArticles] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cells, setCells] = useState({})       // `${art}|${ym}` -> string (редаговане плоске значення)
  const [plainIds, setPlainIds] = useState({}) // ids плоских рядків для клітинки
  const [extras, setExtras] = useState({})     // деталізовані/шаблонні суми (тільки показ)
  const [planNetDB, setPlanNetDB] = useState({}) // YYYY-MM -> net плану (всі роки, з БД)
  const [fc, setFc] = useState(null)           // база прогнозу: залишки, борги, замовлення, тренд
  const dirtyRef = useRef(new Set())

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  const artType = {}
  articles.forEach(a => { artType[a.name] = a.type })
  const dirOf = (art) => artType[art] === 'income' ? 'Доходи' : 'Витрати'

  const load = async () => {
    setLoading(true)
    const [arts, { data: plans }, { data: bankTxs }, { data: cashTxs }, { data: docs }] = await Promise.all([
      fetchArticles(),
      supabase.from('plans').select('*'),
      supabase.from('bank_transactions').select('amount, direction, date').eq('is_ignored', false).eq('is_validated', true),
      supabase.from('cash_transactions').select('amount, type'),
      supabase.from('generated_docs').select('doc_type, doc_date, total, status, bank_transaction_id'),
    ])
    setArticles(arts)

    // ── План: клітинки поточного року + net плану по всіх місяцях ──
    const cellVals = {}, ids = {}, extraVals = {}, netDB = {}
    ;(plans || []).forEach(p => {
      if (p.direction !== 'Доходи' && p.direction !== 'Витрати') return
      const art = p.article || '(без статті)'
      const amt = parseFloat(p.amount) || 0
      const sign = p.direction === 'Доходи' ? 1 : -1

      if (p.is_template) {
        expandTemplate(p).forEach(ym => {
          netDB[ym] = (netDB[ym] || 0) + sign * amt
          if (ym.startsWith(String(year))) {
            const k = `${art}|${ym}`
            extraVals[k] = (extraVals[k] || 0) + amt
          }
        })
        return
      }
      if (!p.year_month) return
      netDB[p.year_month] = (netDB[p.year_month] || 0) + sign * amt
      if (!p.year_month.startsWith(String(year))) return
      const k = `${art}|${p.year_month}`
      if (isPlainRow(p)) {
        cellVals[k] = (parseFloat(cellVals[k]) || 0) + amt
        if (!ids[k]) ids[k] = []
        ids[k].push(p.id)
      } else {
        extraVals[k] = (extraVals[k] || 0) + amt
      }
    })
    Object.keys(cellVals).forEach(k => { cellVals[k] = String(cellVals[k]) })

    // ── База грошового прогнозу ──
    const bankIncome = (bankTxs || []).filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const bankExpense = (bankTxs || []).filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const bankBalance = bankIncome - bankExpense
    const cashBal = (cashTxs || []).reduce((s, t) => s + (CASH_DIR[t.type] || 0) * (t.amount || 0), 0)

    // Тренд: середній місячний потік за останні 3 місяці
    const threeAgo = new Date(); threeAgo.setMonth(threeAgo.getMonth() - 3)
    const recent = (bankTxs || []).filter(t => t.date && new Date(t.date) >= threeAgo)
    const recInc = recent.filter(t => t.direction === 'Доходи').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const recExp = recent.filter(t => t.direction === 'Витрати').reduce((s, t) => s + Math.abs(t.amount || 0), 0)
    const monthsCount = Math.max(1, Math.ceil((Date.now() - threeAgo.getTime()) / (30 * 86400000)))
    const avgMonthlyNet = Math.round((recInc - recExp) / monthsCount)

    // Дебіторка / кредиторка з aging → розподіл по найближчих місяцях
    const today = new Date()
    const debtByMonth = [0, 0, 0], credByMonth = [0, 0, 0]
    let ordersIncome = 0, ordersExpense = 0
    ;(docs || []).forEach(d => {
      if (d.status === 'cancelled') return
      const amt = parseFloat(d.total) || 0
      if ((d.doc_type === 'salesOrder' || d.doc_type === 'purchaseOrder') && ['confirmed', 'in_progress'].includes(d.status)) {
        if (d.doc_type === 'salesOrder') ordersIncome += amt; else ordersExpense += amt
        return
      }
      if (d.bank_transaction_id) return // оплачено
      const days = d.doc_date ? Math.floor((today - new Date(d.doc_date)) / 86400000) : 999
      const idx = days <= 60 ? 0 : days <= 90 ? 1 : 2
      if (['waybill', 'serviceAct'].includes(d.doc_type)) debtByMonth[idx] += amt
      if (d.doc_type === 'incomingWaybill') credByMonth[idx] += amt
    })

    setPlanNetDB(netDB)
    setFc({ bankBalance, cashBal, opening: bankBalance + cashBal, debtByMonth, credByMonth, ordersIncome, ordersExpense, avgMonthlyNet })
    setCells(cellVals)
    setPlainIds(ids)
    setExtras(extraVals)
    dirtyRef.current = new Set()
    setLoading(false)
  }

  useEffect(() => { load() }, [year])

  // ── Групування статей по pl_level ──
  const PL_SECTIONS = ['revenue', 'cogs', 'opex', 'other_income', 'below_line']
  const plLevelOf = (a) => {
    if (a.pl_level && PL_SECTIONS.includes(a.pl_level)) return a.pl_level
    if (a.type === 'income') return 'revenue'
    if (a.type === 'expense') return 'opex'
    return null
  }
  const byLevel = {}
  PL_SECTIONS.forEach(l => { byLevel[l] = [] })
  const incomeExpenseArts = articles.filter(a => a.type === 'income' || a.type === 'expense')
  incomeExpenseArts.forEach(a => {
    const lvl = plLevelOf(a)
    if (lvl && !byLevel[lvl].includes(a.name)) byLevel[lvl].push(a.name)
  })

  const cellTotal = (art, ym) => {
    const k = `${art}|${ym}`
    return (parseFloat(cells[k]) || 0) + (extras[k] || 0)
  }
  const sectionMonthTotal = (level, ym) => (byLevel[level] || []).reduce((s, art) => s + cellTotal(art, ym), 0)
  const sectionYearTotal = (level) => months.reduce((s, ym) => s + sectionMonthTotal(level, ym), 0)

  const calcMonth = (level, ym) => {
    const rev = sectionMonthTotal('revenue', ym)
    const cogs = sectionMonthTotal('cogs', ym)
    const opex = sectionMonthTotal('opex', ym)
    const oth = sectionMonthTotal('other_income', ym)
    const below = sectionMonthTotal('below_line', ym)
    if (level === '_gp') return rev - cogs
    if (level === '_ebit') return rev - cogs - opex
    if (level === '_np') return rev - cogs - opex + oth
    if (level === '_net') return rev - cogs - opex + oth - below
    return 0
  }
  const calcYear = (level) => months.reduce((s, ym) => s + calcMonth(level, ym), 0)

  // Плановий операційний потік для місяця (наживо з клітинок поточного року, або з БД)
  const livePlanNet = (ym) => incomeExpenseArts.reduce((s, a) =>
    s + (a.type === 'income' ? 1 : -1) * cellTotal(a.name, ym), 0)
  const planNetForMonth = (ym) => {
    if (months.includes(ym)) return { net: Math.round(livePlanNet(ym)), src: 'план' }
    if (planNetDB[ym] !== undefined) return { net: Math.round(planNetDB[ym]), src: 'план' }
    return { net: fc ? fc.avgMonthlyNet : 0, src: 'тренд' }
  }

  const onCellChange = (art, ym, val) => {
    const k = `${art}|${ym}`
    dirtyRef.current.add(k)
    setCells(c => ({ ...c, [k]: val.replace(/[^\d.]/g, '') }))
  }

  const saveCell = async (art, ym) => {
    const k = `${art}|${ym}`
    if (!dirtyRef.current.has(k)) return
    dirtyRef.current.delete(k)
    setSaving(true)
    const val = parseFloat(cells[k]) || 0
    const ids = plainIds[k] || []
    if (ids.length) await supabase.from('plans').delete().in('id', ids)
    let newIds = []
    if (val > 0) {
      const { data } = await supabase.from('plans').insert({
        year_month: ym, direction: dirOf(art), article: art, amount: val,
        planned_date: ym + '-01', is_template: false, created_by: user?.id || null,
      }).select('id')
      newIds = (data || []).map(r => r.id)
    }
    setPlainIds(p => ({ ...p, [k]: newIds }))
    // оновлюємо net у БД-карті, щоб прогноз поза поточним роком теж був свіжий
    setSaving(false)
  }

  const fillRow = async (art) => {
    const firstYm = months.find(ym => parseFloat(cells[`${art}|${ym}`]) > 0)
    if (!firstYm) return
    const val = cells[`${art}|${firstYm}`]
    if (!confirm(`Заповнити всі 12 місяців значенням ${fmt(parseFloat(val))} грн для «${art}»?`)) return
    setSaving(true)
    const dir = dirOf(art)
    for (const ym of months) {
      const ids = plainIds[`${art}|${ym}`] || []
      if (ids.length) await supabase.from('plans').delete().in('id', ids)
    }
    await supabase.from('plans').insert(months.map(ym => ({
      year_month: ym, direction: dir, article: art, amount: parseFloat(val),
      planned_date: ym + '-01', is_template: false, created_by: user?.id || null,
    })))
    setSaving(false)
    load()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Завантаження...</div>

  const thBase = { padding: '8px 10px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap' }
  const curYm = new Date().toISOString().substring(0, 7)

  const cellInput = (art, ym) => {
    const k = `${art}|${ym}`
    const ex = extras[k] || 0
    const isCur = ym === curYm
    return (
      <td key={ym} style={{ padding: '2px 4px', textAlign: 'right', background: isCur ? '#EFF4FF' : '', position: 'relative' }}>
        <input
          value={cells[k] ?? ''}
          onChange={e => onCellChange(art, ym, e.target.value)}
          onBlur={() => saveCell(art, ym)}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          inputMode="decimal"
          placeholder="—"
          style={{ width: 72, textAlign: 'right', border: '1px solid transparent', borderRadius: 6, padding: '5px 6px', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', background: 'transparent', color: 'var(--text)', fontFamily: 'inherit' }}
          onFocus={e => { e.target.style.border = '1px solid var(--blue)'; e.target.style.background = 'var(--surface)' }}
          onMouseEnter={e => { if (document.activeElement !== e.target) e.target.style.border = '1px solid var(--border)' }}
          onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.border = '1px solid transparent' }}
        />
        {ex > 0 && (
          <span title={`+ ${fmt(ex)} грн з деталізованих / шаблонних записів`} style={{ position: 'absolute', top: 1, right: 3, fontSize: 9, color: 'var(--amber)', fontWeight: 600 }}>+{fmt(ex)}</span>
        )}
      </td>
    )
  }

  // ── Грошовий прогноз (наживо з плану) ──
  const balColor = n => n >= 0 ? 'var(--green)' : 'var(--red)'
  const now = new Date()
  const fcRows = []
  let bal = fc ? fc.opening : 0
  for (let i = 1; i <= FC_MONTHS; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const idx = i - 1
    const debtIn = idx < 3 && fc ? fc.debtByMonth[idx] : 0
    const credOut = idx < 3 && fc ? fc.credByMonth[idx] : 0
    const ordIn = i === 1 && fc ? fc.ordersIncome : 0
    const ordOut = i === 1 && fc ? fc.ordersExpense : 0
    const { net: opNet, src } = planNetForMonth(ym)
    const open = bal
    const close = open + debtIn + ordIn - credOut - ordOut + opNet
    fcRows.push({ ym, name: MONTH_FULL[d.getMonth()].slice(0, 3), open, debtIn, credOut, ordIn, ordOut, opNet, src, close })
    bal = close
  }
  const flowTd = (key, v, sign) => (
    <td key={key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v ? (sign > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)' }}>
      {v ? (sign > 0 ? '+' : '−') + fmt(v) : '—'}
    </td>
  )
  const fcTh = { padding: '8px 10px', textAlign: 'right', fontWeight: 500, color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap', minWidth: 84 }

  return (
    <div>
      {/* Year nav */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-secondary" onClick={() => setYear(y => y - 1)} style={{ width: 'auto', height: 36 }}><i className="ti ti-chevron-left" /></button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{year}</span>
        <button className="btn btn-sm btn-secondary" onClick={() => setYear(y => y + 1)} style={{ width: 'auto', height: 36 }}><i className="ti ti-chevron-right" /></button>
        <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 8 }}>
          Введіть план — грошовий прогноз нижче оновлюється одразу. {saving && <span style={{ color: 'var(--blue)' }}>Збереження…</span>}
        </span>
      </div>

      {/* ── БЮДЖЕТ (план P&L) ── */}
      <div className="card" style={{ padding: '14px 0', overflowX: 'auto', marginBottom: 16 }}>
        <div style={{ padding: '0 18px 12px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          <i className="ti ti-calendar-dollar" style={{ marginRight: 6, color: 'var(--blue)' }} />
          Бюджет {year} — план P&L
          <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>суми без ПДВ</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1000 }}>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: 'left', minWidth: 190, position: 'sticky', left: 0, zIndex: 2 }}>Стаття</th>
              {months.map((ym, i) => (
                <th key={ym} style={{ ...thBase, textAlign: 'right', background: ym === curYm ? '#EFF4FF' : 'var(--surface2)', color: ym === curYm ? 'var(--blue)' : 'var(--text2)' }}>{MONTH_SHORT[i]}</th>
              ))}
              <th style={{ ...thBase, textAlign: 'right', borderLeft: '2px solid var(--border)', color: 'var(--text)', fontWeight: 700 }}>РІК</th>
              <th style={{ ...thBase, width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {PL_ORDER.map(level => {
              if (level.startsWith('_')) {
                const isNet = level === '_net'
                const yr = calcYear(level)
                return (
                  <tr key={level} style={{ borderTop: '2px solid var(--border)', background: isNet ? '#EFF5EF' : 'var(--surface2)' }}>
                    <td style={{ padding: isNet ? '10px 18px' : '8px 18px', fontWeight: 700, fontSize: isNet ? 14 : 13, position: 'sticky', left: 0, background: isNet ? '#EFF5EF' : 'var(--surface2)', zIndex: 1 }}>{PL_LABELS[level]}</td>
                    {months.map(ym => {
                      const v = calcMonth(level, ym)
                      return <td key={ym} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: numColor(v), background: ym === curYm ? '#EFF4FF' : (isNet ? '#EFF5EF' : 'var(--surface2)') }}>{fmtS(v)}</td>
                    })}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: numColor(yr), borderLeft: '2px solid var(--border)' }}>{fmtS(yr)}</td>
                    <td></td>
                  </tr>
                )
              }
              const rows = byLevel[level] || []
              if (rows.length === 0) return null
              const sign = PL_SIGN[level] || 1
              return (
                <React.Fragment key={level}>
                  <tr>
                    <td colSpan={months.length + 3} style={{ padding: '10px 18px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>{PL_LABELS[level]}</td>
                  </tr>
                  {rows.map(art => {
                    const yr = sign * months.reduce((s, ym) => s + cellTotal(art, ym), 0)
                    return (
                      <tr key={art} style={{ borderBottom: '1px solid #F0F2F5' }}>
                        <td style={{ padding: '4px 18px 4px 28px', fontSize: 13, position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{art}</td>
                        {months.map(ym => cellInput(art, ym))}
                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: numColor(yr), borderLeft: '2px solid var(--border)' }}>{fmtS(yr)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => fillRow(art)} title="Заповнити всі місяці першим значенням" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}>
                            <i className="ti ti-arrow-bar-to-right" style={{ fontSize: 14 }} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    <td style={{ padding: '6px 18px', fontWeight: 600, fontSize: 12.5, color: 'var(--text2)', position: 'sticky', left: 0, background: 'var(--surface2)', zIndex: 1 }}>Разом {(PL_LABELS[level] || level).toLowerCase()}</td>
                    {months.map(ym => {
                      const v = sign * sectionMonthTotal(level, ym)
                      return <td key={ym} style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: numColor(v), background: ym === curYm ? '#EFF4FF' : 'var(--surface2)' }}>{fmtS(v)}</td>
                    })}
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: numColor(sign * sectionYearTotal(level)), borderLeft: '2px solid var(--border)' }}>{fmtS(sign * sectionYearTotal(level))}</td>
                    <td></td>
                  </tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
        <div style={{ padding: '12px 18px 0', fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
          <i className="ti ti-info-circle" style={{ marginRight: 5 }} />
          Це <b>плановий P&L</b>. Звірити з фактом — у вкладці <b>P&L → Порівняння</b>. Значок <span style={{ color: 'var(--amber)', fontWeight: 600 }}>+N</span> — додаткові деталізовані/повторювані записи.
        </div>
      </div>

      {/* ── ГРОШОВИЙ ПРОГНОЗ (наживо з плану) ── */}
      <div className="card" style={{ padding: '14px 0', overflowX: 'auto' }}>
        <div style={{ padding: '0 18px 12px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          <i className="ti ti-crystal-ball" style={{ marginRight: 6, color: 'var(--blue)' }} />
          Грошовий прогноз на {FC_MONTHS} міс.
          <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>скільки буде на рахунку + в касі</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: 'left', minWidth: 230, position: 'sticky', left: 0, zIndex: 2 }}>Рух коштів</th>
              {fcRows.map(r => <th key={r.ym} style={fcTh}>{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 18px', fontWeight: 500, position: 'sticky', left: 0, background: 'var(--surface)' }}>Залишок на початок</td>
              {fcRows.map(r => <td key={r.ym} style={{ textAlign: 'right', color: balColor(r.open), fontVariantNumeric: 'tabular-nums' }}>{fmt(r.open)}</td>)}
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 18px', position: 'sticky', left: 0, background: 'var(--surface)' }}>+ Дебіторка<div style={{ fontSize: 10, color: 'var(--text3)' }}>нам винні — за строком боргу</div></td>
              {fcRows.map(r => flowTd(r.ym, r.debtIn, 1))}
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 18px', position: 'sticky', left: 0, background: 'var(--surface)' }}>+ Замовлення клієнтів</td>
              {fcRows.map(r => flowTd(r.ym, r.ordIn, 1))}
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 18px', position: 'sticky', left: 0, background: 'var(--surface)' }}>− Кредиторка<div style={{ fontSize: 10, color: 'var(--text3)' }}>ми винні — за строком боргу</div></td>
              {fcRows.map(r => flowTd(r.ym, r.credOut, -1))}
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 18px', position: 'sticky', left: 0, background: 'var(--surface)' }}>− Замовлення постачальникам</td>
              {fcRows.map(r => flowTd(r.ym, r.ordOut, -1))}
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 18px', position: 'sticky', left: 0, background: 'var(--surface)' }}>± Операційний потік<div style={{ fontSize: 10, color: 'var(--text3)' }}>з бюджету вище</div></td>
              {fcRows.map(r => (
                <td key={r.ym} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.opNet >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {r.opNet ? (r.opNet > 0 ? '+' : '−') + fmt(r.opNet) : '—'}
                  <div style={{ fontSize: 9, color: r.src === 'план' ? 'var(--blue)' : 'var(--text3)' }}>{r.src}</div>
                </td>
              ))}
            </tr>
            <tr style={{ borderTop: '3px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
              <td style={{ padding: '9px 18px', position: 'sticky', left: 0, background: 'var(--surface)' }}>= Залишок на кінець</td>
              {fcRows.map(r => (
                <td key={r.ym} style={{ textAlign: 'right', color: balColor(r.close), fontVariantNumeric: 'tabular-nums', background: r.close < 0 ? 'var(--red-bg)' : undefined }}>
                  {fmt(r.close)}
                  {r.close < 0 && <div style={{ fontSize: 10, color: 'var(--red)' }}>⚠ дефіцит</div>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <div style={{ padding: '12px 18px 0', fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
          <i className="ti ti-info-circle" style={{ marginRight: 5 }} />
          Залишок на початок наступного місяця = залишок на кінець попереднього. «Операційний потік» береться з бюджету вище (позначка <span style={{ color: 'var(--blue)' }}>план</span>); якщо на місяць плану немає — середній потік за 3 міс. (<span>тренд</span>). Дебіторка/кредиторка рознесені за строком боргу.
        </div>
      </div>
    </div>
  )
}
