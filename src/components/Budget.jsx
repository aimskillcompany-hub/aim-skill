import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchArticles, PL_ORDER, PL_LABELS, PL_SIGN } from '../lib/articles'
import { fmtInt as fmt } from '../lib/fmt'

// Бюджет (План P&L) — редагована таблиця у форматі P&L.
// Рядки — статті, згруповані по pl_level (як у фактичному P&L).
// Колонки — місяці року. Введення суми створює/оновлює "плоский" плановий
// запис у таблиці plans (без шаблону, без контрагента/проєкту/опису).
// Деталізовані та шаблонні записи цей грід не чіпає — лише показує їх внесок.

const MONTH_SHORT = ['Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру']
const fmtS = n => n === 0 ? '—' : (n > 0 ? '+' : '−') + fmt(n)
const numColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)'

// "Плоский" запис — той, яким керує грід (без додаткових атрибутів)
const isPlainRow = (p) => !p.is_template && !p.contractor && !p.project_id && !p.description

// Розгорнути шаблон у конкретні місяці року
function expandTemplateForYear(p, year) {
  const out = []
  if (!p.is_template || !p.template_from || !p.template_to) return out
  let [fy, fm] = p.template_from.split('-').map(Number)
  const [ty, tm] = p.template_to.split('-').map(Number)
  while (fy < ty || (fy === ty && fm <= tm)) {
    if (fy === year) out.push(`${fy}-${String(fm).padStart(2, '0')}`)
    fm++; if (fm > 12) { fm = 1; fy++ }
  }
  return out
}

export default function Budget({ user }) {
  const [articles, setArticles] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // cell value (рядок, що редагується): `${art}|${ym}` -> string
  const [cells, setCells] = useState({})
  // ids "плоских" рядків для кожної клітинки (щоб оновлювати/видаляти)
  const [plainIds, setPlainIds] = useState({})
  // сума деталізованих/шаблонних записів (тільки для відображення)
  const [extras, setExtras] = useState({})
  const dirtyRef = useRef(new Set())

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  const artType = {}
  articles.forEach(a => { artType[a.name] = a.type })
  const dirOf = (art) => artType[art] === 'income' ? 'Доходи' : 'Витрати'

  const load = async () => {
    setLoading(true)
    const [arts, { data: plans }] = await Promise.all([
      fetchArticles(),
      supabase.from('plans').select('*'),
    ])
    setArticles(arts)

    const cellVals = {}, ids = {}, extraVals = {}
    ;(plans || []).forEach(p => {
      if (p.direction !== 'Доходи' && p.direction !== 'Витрати') return
      const art = p.article || '(без статті)'
      const amt = parseFloat(p.amount) || 0

      if (p.is_template) {
        expandTemplateForYear(p, year).forEach(ym => {
          const k = `${art}|${ym}`
          extraVals[k] = (extraVals[k] || 0) + amt
        })
        return
      }
      if (!p.year_month || !p.year_month.startsWith(String(year))) return
      const k = `${art}|${p.year_month}`
      if (isPlainRow(p)) {
        cellVals[k] = (parseFloat(cellVals[k]) || 0) + amt
        if (!ids[k]) ids[k] = []
        ids[k].push(p.id)
      } else {
        extraVals[k] = (extraVals[k] || 0) + amt
      }
    })
    // нормалізуємо плоскі значення у рядки
    Object.keys(cellVals).forEach(k => { cellVals[k] = String(cellVals[k]) })

    setCells(cellVals)
    setPlainIds(ids)
    setExtras(extraVals)
    dirtyRef.current = new Set()
    setLoading(false)
  }

  useEffect(() => { load() }, [year])

  // Групування статей по pl_level (як у фактичному P&L)
  const PL_SECTIONS = ['revenue', 'cogs', 'opex', 'other_income', 'below_line']
  const plLevelOf = (a) => {
    if (a.pl_level && PL_SECTIONS.includes(a.pl_level)) return a.pl_level
    if (a.type === 'income') return 'revenue'
    if (a.type === 'expense') return 'opex'
    return null
  }
  const byLevel = {}
  PL_SECTIONS.forEach(l => { byLevel[l] = [] })
  articles
    .filter(a => a.type === 'income' || a.type === 'expense')
    .forEach(a => {
      const lvl = plLevelOf(a)
      if (lvl && !byLevel[lvl].includes(a.name)) byLevel[lvl].push(a.name)
    })

  // значення клітинки (план разом із деталізованими/шаблонними)
  const cellTotal = (art, ym) => {
    const k = `${art}|${ym}`
    return (parseFloat(cells[k]) || 0) + (extras[k] || 0)
  }
  const sectionMonthTotal = (level, ym) =>
    (byLevel[level] || []).reduce((s, art) => s + cellTotal(art, ym), 0)
  const sectionYearTotal = (level) =>
    months.reduce((s, ym) => s + sectionMonthTotal(level, ym), 0)

  // Розрахункові рядки
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
        year_month: ym,
        direction: dirOf(art),
        article: art,
        amount: val,
        planned_date: ym + '-01',
        is_template: false,
        created_by: user?.id || null,
      }).select('id')
      newIds = (data || []).map(r => r.id)
    }
    setPlainIds(p => ({ ...p, [k]: newIds }))
    setSaving(false)
  }

  // Копіювати перше непорожнє значення рядка в усі місяці
  const fillRow = async (art) => {
    const firstYm = months.find(ym => parseFloat(cells[`${art}|${ym}`]) > 0)
    if (!firstYm) return
    const val = cells[`${art}|${firstYm}`]
    if (!confirm(`Заповнити всі 12 місяців значенням ${fmt(parseFloat(val))} грн для «${art}»?`)) return
    setSaving(true)
    const dir = dirOf(art)
    for (const ym of months) {
      const k = `${art}|${ym}`
      const ids = plainIds[k] || []
      if (ids.length) await supabase.from('plans').delete().in('id', ids)
    }
    const rows = months.map(ym => ({
      year_month: ym, direction: dir, article: art, amount: parseFloat(val),
      planned_date: ym + '-01', is_template: false, created_by: user?.id || null,
    }))
    await supabase.from('plans').insert(rows)
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
          style={{
            width: 72, textAlign: 'right', border: '1px solid transparent', borderRadius: 6,
            padding: '5px 6px', fontSize: 12.5, fontVariantNumeric: 'tabular-nums',
            background: 'transparent', color: 'var(--text)', fontFamily: 'inherit',
          }}
          onFocus={e => { e.target.style.border = '1px solid var(--blue)'; e.target.style.background = 'var(--surface)' }}
          onMouseEnter={e => { if (document.activeElement !== e.target) e.target.style.border = '1px solid var(--border)' }}
          onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.border = '1px solid transparent' }}
        />
        {ex > 0 && (
          <span title={`+ ${fmt(ex)} грн з деталізованих / шаблонних записів`}
            style={{ position: 'absolute', top: 1, right: 3, fontSize: 9, color: 'var(--amber)', fontWeight: 600 }}>+{fmt(ex)}</span>
        )}
      </td>
    )
  }

  return (
    <div>
      {/* Year nav + hint */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-secondary" onClick={() => setYear(y => y - 1)} style={{ width: 'auto', height: 36 }}>
          <i className="ti ti-chevron-left" />
        </button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{year}</span>
        <button className="btn btn-sm btn-secondary" onClick={() => setYear(y => y + 1)} style={{ width: 'auto', height: 36 }}>
          <i className="ti ti-chevron-right" />
        </button>
        <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 8 }}>
          Введіть планові суми по статтях — це бюджет P&L. {saving && <span style={{ color: 'var(--blue)' }}>Збереження…</span>}
        </span>
      </div>

      <div className="card" style={{ padding: '14px 0', overflowX: 'auto' }}>
        <div style={{ padding: '0 18px 12px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          Бюджет {year} — План P&L
          <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>
            суми без ПДВ, у форматі звіту про прибутки
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1000 }}>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: 'left', minWidth: 190, position: 'sticky', left: 0, zIndex: 2 }}>Стаття</th>
              {months.map((ym, i) => (
                <th key={ym} style={{ ...thBase, textAlign: 'right', background: ym === curYm ? '#EFF4FF' : 'var(--surface2)', color: ym === curYm ? 'var(--blue)' : 'var(--text2)' }}>
                  {MONTH_SHORT[i]}
                </th>
              ))}
              <th style={{ ...thBase, textAlign: 'right', borderLeft: '2px solid var(--border)', color: 'var(--text)', fontWeight: 700 }}>РІК</th>
              <th style={{ ...thBase, width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {PL_ORDER.map(level => {
              // Розрахунковий рядок
              if (level.startsWith('_')) {
                const isNet = level === '_net'
                const yr = calcYear(level)
                return (
                  <tr key={level} style={{ borderTop: '2px solid var(--border)', background: isNet ? '#EFF5EF' : 'var(--surface2)' }}>
                    <td style={{ padding: isNet ? '10px 18px' : '8px 18px', fontWeight: 700, fontSize: isNet ? 14 : 13, position: 'sticky', left: 0, background: isNet ? '#EFF5EF' : 'var(--surface2)', zIndex: 1 }}>
                      {PL_LABELS[level]}
                    </td>
                    {months.map(ym => {
                      const v = calcMonth(level, ym)
                      return <td key={ym} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: numColor(v), background: ym === curYm ? '#EFF4FF' : (isNet ? '#EFF5EF' : 'var(--surface2)') }}>{fmtS(v)}</td>
                    })}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: numColor(yr), borderLeft: '2px solid var(--border)' }}>{fmtS(yr)}</td>
                    <td></td>
                  </tr>
                )
              }

              // Секція зі статтями
              const rows = byLevel[level] || []
              if (rows.length === 0) return null
              const sign = PL_SIGN[level] || 1
              return (
                <React.Fragment key={level}>
                  <tr>
                    <td colSpan={months.length + 3} style={{ padding: '10px 18px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
                      {PL_LABELS[level]}
                    </td>
                  </tr>
                  {rows.map(art => {
                    const yr = sign * months.reduce((s, ym) => s + cellTotal(art, ym), 0)
                    return (
                      <tr key={art} style={{ borderBottom: '1px solid #F0F2F5' }}>
                        <td style={{ padding: '4px 18px 4px 28px', fontSize: 13, position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{art}</td>
                        {months.map(ym => cellInput(art, ym))}
                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: numColor(yr), borderLeft: '2px solid var(--border)' }}>{fmtS(yr)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => fillRow(art)} title="Заповнити всі місяці першим значенням"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}>
                            <i className="ti ti-arrow-bar-to-right" style={{ fontSize: 14 }} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    <td style={{ padding: '6px 18px', fontWeight: 600, fontSize: 12.5, color: 'var(--text2)', position: 'sticky', left: 0, background: 'var(--surface2)', zIndex: 1 }}>
                      Разом {(PL_LABELS[level] || level).toLowerCase()}
                    </td>
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
          Введені суми — це <b>плановий P&L</b>. Порівняти з фактом можна у вкладці <b>P&L → Порівняння</b>.
          Значок <span style={{ color: 'var(--amber)', fontWeight: 600 }}>+N</span> у клітинці означає додаткові деталізовані або повторювані записи (керуються окремо).
        </div>
      </div>
    </div>
  )
}
