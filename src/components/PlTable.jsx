import React from 'react'
import { PL_ORDER, PL_LABELS, PL_SIGN } from '../lib/articles'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))
const fmtS = n => n === 0 ? '—' : (n > 0 ? '+' : '−') + fmt(n)
const numColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)'

const cellStyle = (v, bold) => ({
  padding: '7px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  color: v === 0 ? 'var(--text3)' : numColor(v),
  fontWeight: bold ? 500 : 400, whiteSpace: 'nowrap', fontSize: 12.5,
})

// Групує статті по pl_level і будує P&L ієрархію
export function buildPlData(articles, artData, months) {
  const plSections = ['revenue', 'cogs', 'opex', 'other_income', 'below_line']
  const artPlMap = {}
  articles.forEach(a => { artPlMap[a.name] = a.pl_level || 'none' })

  // Infer pl_level for articles not in settings
  Object.keys(artData).forEach(name => {
    if (!artPlMap[name]) {
      const txs = Object.values(artData[name] || {}).flatMap(d => d.txs)
      const dir = txs[0]?.direction
      if (dir === 'Доходи') artPlMap[name] = 'revenue'
      else if (dir === 'Витрати') artPlMap[name] = 'opex'
      else artPlMap[name] = 'transfer'
    }
  })

  // Group by pl_level
  const byLevel = {}
  plSections.forEach(l => { byLevel[l] = [] })
  articles.forEach(a => {
    const level = a.pl_level || 'none'
    if (level === 'transfer' || level === 'none') return
    if (artData[a.name] && byLevel[level] && !byLevel[level].includes(a.name)) byLevel[level].push(a.name)
  })
  Object.keys(artData).forEach(name => {
    const level = artPlMap[name] || 'opex'
    if (level === 'transfer' || level === 'none') return
    if (byLevel[level] && !byLevel[level].includes(name)) byLevel[level].push(name)
  })

  // Section totals
  const sectionTotals = {}
  plSections.forEach(level => {
    sectionTotals[level] = {}
    months.forEach(m => {
      sectionTotals[level][m] = (byLevel[level] || []).reduce((s, name) => s + (artData[name]?.[m]?.sum || 0), 0)
    })
    sectionTotals[level]._total = months.reduce((s, m) => s + (sectionTotals[level][m] || 0), 0)
  })

  // Calculated rows
  const calcRow = (fn) => {
    const row = {}
    months.forEach(m => { row[m] = fn(m) })
    row._total = months.reduce((s, m) => s + (row[m] || 0), 0)
    return row
  }

  const calcRows = {
    _gp: calcRow(m => (sectionTotals.revenue?.[m] || 0) - (sectionTotals.cogs?.[m] || 0)),
    _ebit: calcRow(m => (sectionTotals.revenue?.[m] || 0) - (sectionTotals.cogs?.[m] || 0) - (sectionTotals.opex?.[m] || 0)),
    _np: calcRow(m => (sectionTotals.revenue?.[m] || 0) - (sectionTotals.cogs?.[m] || 0) - (sectionTotals.opex?.[m] || 0) + (sectionTotals.other_income?.[m] || 0)),
    _net: calcRow(m => (sectionTotals.revenue?.[m] || 0) - (sectionTotals.cogs?.[m] || 0) - (sectionTotals.opex?.[m] || 0) + (sectionTotals.other_income?.[m] || 0) - (sectionTotals.below_line?.[m] || 0)),
  }

  return { byLevel, sectionTotals, calcRows }
}

export default function PlTable({ artData, months, plData, isCurrent, onCellClick, onSectionClick }) {
  const { byLevel, sectionTotals, calcRows } = plData

  return (
    <tbody>
      {PL_ORDER.map(level => {
        // Розрахункові рядки
        if (level.startsWith('_')) {
          const row = calcRows[level]
          if (!row) return null
          const isNet = level === '_net'
          return (
            <tr key={level} style={{ borderTop: '2px solid var(--border)', background: isNet ? '#EFF5EF' : 'var(--surface2)' }}>
              <td style={{ padding: isNet ? '10px 18px' : '8px 18px', fontWeight: 700, fontSize: isNet ? 14 : 13, color: 'var(--text)', position: 'sticky', left: 0, background: isNet ? '#EFF5EF' : 'var(--surface2)' }}>
                {PL_LABELS[level]}
              </td>
              {months.map(m => (
                <td key={m} style={{ ...cellStyle(row[m] || 0, true), background: isCurrent(m) ? '#EFF4FF' : isNet ? '#EFF5EF' : 'var(--surface2)', fontSize: isNet ? 13 : 12.5 }}>
                  {fmtS(row[m] || 0)}
                </td>
              ))}
              <td style={{ ...cellStyle(row._total, true), background: '#EFF4FF', borderLeft: '2px solid #E2E8F0' }}>
                {fmtS(row._total)}
              </td>
            </tr>
          )
        }

        // Секції з статтями
        const rows = byLevel[level] || []
        if (rows.length === 0) return null
        const secTotal = sectionTotals[level]?._total || 0
        if (secTotal === 0 && rows.every(name => !artData[name])) return null
        const sign = PL_SIGN[level] || 1

        return (
          <React.Fragment key={level}>
            <tr>
              <td colSpan={months.length + 2} style={{ padding: '10px 18px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
                {PL_LABELS[level] || level}
              </td>
            </tr>

            {rows.map(artName => {
              const rowTotal = months.reduce((s, m) => s + (artData[artName]?.[m]?.sum || 0), 0)
              if (rowTotal === 0 && !artData[artName]) return null
              return (
                <tr key={artName} style={{ borderBottom: '1px solid #F0F2F5' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '7px 18px 7px 28px', fontSize: 13, color: 'var(--text)', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>
                    {artName}
                  </td>
                  {months.map(m => {
                    const v = sign * (artData[artName]?.[m]?.sum || 0)
                    return (
                      <td key={m} style={{ ...cellStyle(v, false), cursor: v !== 0 ? 'pointer' : 'default', background: isCurrent(m) ? '#EFF4FF' : '' }}
                        onClick={() => onCellClick && onCellClick(artName, m)}>
                        {fmtS(v)}
                      </td>
                    )
                  })}
                  <td style={{ ...cellStyle(sign * rowTotal, true), background: '#EFF4FF', borderLeft: '2px solid #E2E8F0' }}>
                    {fmtS(sign * rowTotal)}
                  </td>
                </tr>
              )
            })}

            <tr style={{ borderTop: '2px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 18px', fontWeight: 700, fontSize: 13, color: 'var(--text2)', background: 'var(--surface2)', position: 'sticky', left: 0 }}>
                Разом {(PL_LABELS[level] || level).toLowerCase()}
              </td>
              {months.map(m => {
                const v = sign * (sectionTotals[level]?.[m] || 0)
                return (
                  <td key={m} style={{ ...cellStyle(v, true), cursor: v !== 0 ? 'pointer' : 'default', background: isCurrent(m) ? '#EFF4FF' : 'var(--surface2)' }}
                    onClick={() => onSectionClick && onSectionClick(level, m)}>
                    {fmtS(v)}
                  </td>
                )
              })}
              <td style={{ ...cellStyle(sign * secTotal, true), background: '#EFF4FF', borderLeft: '2px solid #E2E8F0' }}>
                {fmtS(sign * secTotal)}
              </td>
            </tr>
          </React.Fragment>
        )
      })}
    </tbody>
  )
}
