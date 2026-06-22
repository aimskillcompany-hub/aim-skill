import React from 'react'
import { PL_ORDER, PL_LABELS, PL_SIGN } from '../lib/articles'
import { buildPlData } from './PlTable'
import { fmtInt as fmt } from '../lib/fmt'

// План-факт по P&L-ієрархії за обраний період (агрегат).
// План береться з planData (article -> month -> signedSum), факт — з artData.
// Колонки: План | Факт | Різниця | % виконання.

const fmtS = n => n === 0 ? '—' : (n > 0 ? '+' : '−') + fmt(n)
const numColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)'

export default function PlCompare({ articles, artData, planData, months }) {
  // Синтетичний artData з плану — додатні суми (знак дає PL_SIGN)
  const planArt = {}
  Object.keys(planData || {}).forEach(name => {
    planArt[name] = {}
    months.forEach(m => {
      const v = planData[name]?.[m]
      if (v) planArt[name][m] = { sum: Math.abs(v), txs: [] }
    })
  })

  const factPl = buildPlData(articles, artData, months)
  const planPl = buildPlData(articles, planArt, months)

  // Об'єднаний перелік статей по рівнях
  const levels = ['revenue', 'cogs', 'opex', 'other_income', 'below_line']
  const mergedByLevel = {}
  levels.forEach(l => {
    mergedByLevel[l] = [...new Set([...(factPl.byLevel[l] || []), ...(planPl.byLevel[l] || [])])]
  })

  const factArt = (name) => months.reduce((s, m) => s + (artData[name]?.[m]?.sum || 0), 0)
  const planArtSum = (name) => months.reduce((s, m) => s + Math.abs(planData[name]?.[m] || 0), 0)

  const pctOf = (fact, plan) => {
    if (!plan) return null
    return Math.round(Math.abs(fact) / Math.abs(plan) * 100)
  }
  // Для витрат «добре» = факт ≤ план; для доходів «добре» = факт ≥ план
  const pctColor = (pct, isIncome) => {
    if (pct == null) return 'var(--text3)'
    if (isIncome) return pct >= 90 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)'
    return pct <= 100 ? 'var(--green)' : pct <= 120 ? 'var(--amber)' : 'var(--red)'
  }

  const Bar = ({ pct, isIncome }) => pct == null ? <span style={{ color: 'var(--text3)' }}>—</span> : (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      <div style={{ width: 46, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: Math.min(pct, 100) + '%', height: '100%', background: pctColor(pct, isIncome), borderRadius: 3 }} />
      </div>
      <span style={{ color: pctColor(pct, isIncome), fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{pct}%</span>
    </div>
  )

  const th = { padding: '9px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap' }
  const td = { padding: '7px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, whiteSpace: 'nowrap' }

  const Row = ({ label, plan, fact, isIncome, bold, indent, head }) => {
    const diff = fact - plan
    const pct = pctOf(fact, plan)
    if (head) {
      return (
        <tr><td colSpan={5} style={{ padding: '10px 18px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>{label}</td></tr>
      )
    }
    return (
      <tr style={{ borderBottom: '1px solid #F0F2F5', background: bold ? 'var(--surface2)' : '' }}>
        <td style={{ padding: indent ? '7px 18px 7px 28px' : '8px 18px', fontSize: bold ? 13 : 13, fontWeight: bold ? 700 : 400, position: 'sticky', left: 0, background: bold ? 'var(--surface2)' : 'var(--surface)' }}>{label}</td>
        <td style={{ ...td, color: plan === 0 ? 'var(--text3)' : numColor(plan), fontWeight: bold ? 700 : 400 }}>{fmtS(plan)}</td>
        <td style={{ ...td, color: fact === 0 ? 'var(--text3)' : numColor(fact), fontWeight: bold ? 700 : 500 }}>{fmtS(fact)}</td>
        <td style={{ ...td, color: diff === 0 ? 'var(--text3)' : (isIncome ? (diff >= 0 ? 'var(--green)' : 'var(--red)') : (diff <= 0 ? 'var(--green)' : 'var(--red)')) }}>
          {plan === 0 && fact === 0 ? '—' : (diff >= 0 ? '+' : '−') + fmt(diff)}
        </td>
        <td style={{ ...td }}><Bar pct={pct} isIncome={isIncome} /></td>
      </tr>
    )
  }

  return (
    <div className="tbl-wrap" style={{ border: 'none', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left', minWidth: 200, position: 'sticky', left: 0, zIndex: 1 }}>Стаття</th>
            <th style={{ ...th, textAlign: 'right' }}>План</th>
            <th style={{ ...th, textAlign: 'right' }}>Факт</th>
            <th style={{ ...th, textAlign: 'right' }}>Різниця</th>
            <th style={{ ...th, textAlign: 'right', minWidth: 110 }}>% виконання</th>
          </tr>
        </thead>
        <tbody>
          {PL_ORDER.map(level => {
            if (level.startsWith('_')) {
              const fact = factPl.calcRows[level]?._total || 0
              const plan = planPl.calcRows[level]?._total || 0
              if (fact === 0 && plan === 0) return null
              const isNet = level === '_net'
              return <Row key={level} label={PL_LABELS[level]} plan={plan} fact={fact} isIncome bold />
            }
            const names = mergedByLevel[level] || []
            if (names.length === 0) return null
            const sign = PL_SIGN[level] || 1
            const isIncome = sign > 0
            const secFact = sign * (factPl.sectionTotals[level]?._total || 0)
            const secPlan = sign * (planPl.sectionTotals[level]?._total || 0)
            if (secFact === 0 && secPlan === 0) return null
            return (
              <React.Fragment key={level}>
                <Row label={PL_LABELS[level]} head />
                {names.map(name => {
                  const fact = sign * factArt(name)
                  const plan = sign * planArtSum(name)
                  if (fact === 0 && plan === 0) return null
                  return <Row key={name} label={name} plan={plan} fact={fact} isIncome={isIncome} indent />
                })}
                <Row label={`Разом ${(PL_LABELS[level] || level).toLowerCase()}`} plan={secPlan} fact={secFact} isIncome={isIncome} bold />
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
