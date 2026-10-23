import { Fragment, useState } from 'react'

// Таблиця даних (ТЗ, розділ 2): липкий заголовок 11 px верхнім регістром, суми праворуч tabular-nums,
// рядки підсумку на #F7F8F6, розкриття рядка; на телефоні (< 768 px) рядки стають картками «підпис — значення».
//   columns [{ key, label, align: 'left'|'right', num, render(row), width, hideOnMobile }]
//   rows, rowKey(row), onRowClick(row), renderExpanded(row) — вміст під рядком, totals [row] — підсумки внизу.
export default function DataTable({ columns = [], rows = [], rowKey = (r, i) => r.id ?? i, onRowClick, renderExpanded, totals = [], empty, caption }) {
  const [open, setOpen] = useState(() => new Set())
  const toggle = (k) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const cell = (c, r) => (c.render ? c.render(r) : r[c.key])
  const colSpan = columns.length + (renderExpanded ? 1 : 0)
  return (
    <div className="tbl-wrap ui-dt">
      <table>
        {caption && <caption className="ui-sr">{caption}</caption>}
        <thead><tr>
          {renderExpanded && <th className="ui-dt-x" aria-label="Розкрити" />}
          {columns.map(c => <th key={c.key} style={{ textAlign: c.align || (c.num ? 'right' : 'left'), width: c.width }} className={c.hideOnMobile ? 'ui-dt-hm' : undefined}>{c.label}</th>)}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={colSpan} className="ui-dt-empty">{empty || 'Немає даних'}</td></tr>}
          {rows.map((r, i) => {
            const k = rowKey(r, i), isOpen = open.has(k)
            const click = onRowClick ? () => onRowClick(r) : renderExpanded ? () => toggle(k) : undefined
            return (
              <Fragment key={k}>
                <tr className={click ? 'is-clickable' : undefined} onClick={click} tabIndex={click ? 0 : undefined}
                  onKeyDown={click ? (e) => { if (e.key === 'Enter') click() } : undefined}>
                  {renderExpanded && <td className="ui-dt-x">
                    <button type="button" aria-expanded={isOpen} aria-label={isOpen ? 'Згорнути' : 'Розкрити'} onClick={(e) => { e.stopPropagation(); toggle(k) }}>
                      <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
                    </button>
                  </td>}
                  {columns.map(c => <td key={c.key} data-label={c.label} style={{ textAlign: c.align || (c.num ? 'right' : 'left') }}
                    className={[c.num && 'ui-num', c.hideOnMobile && 'ui-dt-hm'].filter(Boolean).join(' ') || undefined}>{cell(c, r)}</td>)}
                </tr>
                {renderExpanded && isOpen && <tr className="ui-dt-sub"><td colSpan={colSpan}>{renderExpanded(r)}</td></tr>}
              </Fragment>
            )
          })}
          {totals.map((r, i) => (
            <tr key={`t${i}`} className="ui-dt-total">
              {renderExpanded && <td className="ui-dt-x" />}
              {columns.map(c => <td key={c.key} data-label={c.label} style={{ textAlign: c.align || (c.num ? 'right' : 'left') }}
                className={[c.num && 'ui-num', c.hideOnMobile && 'ui-dt-hm'].filter(Boolean).join(' ') || undefined}>{cell(c, r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
