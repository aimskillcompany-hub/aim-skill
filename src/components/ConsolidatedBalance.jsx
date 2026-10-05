import { useEffect, useState } from 'react'
import { useCompany } from '../lib/company'
import { computeConsolidated } from '../lib/consolidated'
import { forecastNetByDate } from '../lib/forecast'

// Зведений баланс групи — один звіт: рівняння Активи=Зобов'язання+Капітал, три картки, об'єднана
// таблиця «факт + прогноз» по юрособах. Дані/розрахунки — ті самі (computeConsolidated + forecast).

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const now = new Date()
const lastDayStr = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

// ── Форматування (єдине для всієї сторінки) ──
const _int = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const r0 = (n) => Math.round(Number(n) || 0)
const absInt = (n) => _int.format(Math.abs(r0(n)))
const numText = (n) => (r0(n) < 0 ? '−' : '') + absInt(n)              // число зі знаком
// Колір лише за знаком: <0 червоний, =0 світло-сірий, >0 звичайний (або фіолетовий для капіталу)
const numColor = (n, purple) => { const v = r0(n); if (v < 0) return '#C62828'; if (v === 0) return '#A39FB0'; return purple ? '#5B2FD6' : '#17151F' }
const pct1 = (frac) => (Math.abs(frac * 100)).toFixed(1).replace('.', ',') + '%'
const changeText = (delta, base) => { const v = r0(delta); if (v === 0 || !base) return 'без змін'; const p = (delta / base * 100); return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1).replace('.', ',') + '%' }
const barW = (v, total) => { if (!total) return 0; const w = Math.abs(v) / Math.abs(total) * 100; return Math.max(0, Math.min(100, w)) }

const MONO = { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const CARD = { background: '#FFFFFF', border: '1px solid #ECEAF2', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }

const TBL_CSS = `
.zb-bt{width:100%;min-width:1080px;border-collapse:collapse;font-size:14px}
.zb-bt td,.zb-bt th{padding:12px 16px;text-align:right;border-bottom:1px solid #ECEAF2}
.zb-bt td:first-child,.zb-bt th:first-child{text-align:left}
.zb-bt .fc{background:#F1F4FF}
.zb-bt .fcl{border-left:1px dashed #9AA8E8}
.zb-bt .tot td{background:#FAF9FC;font-weight:700;border-bottom:1px solid #D9D5E5}
.zb-bt .tot .fc{background:#E6EBFF}
.zb-bt .sec td{padding-top:22px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5E5A6B;font-weight:700;border-bottom:none}
`

export default function ConsolidatedBalance() {
  const { companies } = useCompany()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!companies?.length) return
    let cancelled = false
    setLoading(true); setErr(null)
    Promise.all([
      computeConsolidated(year, month, companies),
      forecastNetByDate(lastDayStr(year, month)).catch(() => null),
    ])
      .then(([r, f]) => { if (!cancelled) { setData(r); setForecast(f) } })
      .catch(e => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year, month, companies])

  const years = [2025, 2026, 2027].filter(y => y <= now.getFullYear() + 1)

  // Похідні
  const t = data?.total
  const rows = data?.rows || []
  const liabTotal = t ? r0(t.pay) + r0(t.loans) : 0
  const income = forecast?.income || 0, expense = forecast?.expense || 0, net = forecast?.net || 0
  const fCash = t ? t.cash + net : 0
  const fAssets = t ? t.assets + net : 0
  const fEquity = t ? t.equity + net : 0
  const otherNet = t ? t.equity - t.fa - t.cash : 0 // інші чисті активи

  return (
    <div style={{ fontFamily: 'Manrope, system-ui, sans-serif', color: '#17151F', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <style>{TBL_CSS}</style>

      {/* Шапка */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.02em' }}>Зведений баланс групи</h1>
          <div style={{ fontSize: 15, color: '#5E5A6B' }}>
            Станом на {new Date(year, month, 0).getDate()} {MONTHS[month - 1].toLowerCase()} {year} · {companies?.length || 0} юрособи · факт і прогноз в одному звіті
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#5E5A6B', fontWeight: 600 }}>Місяць</label>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selStyle}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#5E5A6B', fontWeight: 600 }}>Рік</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...selStyle, minWidth: 100 }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={() => window.print()} style={{ height: 44, padding: '0 18px', border: 'none', borderRadius: 10, background: '#17151F', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            <i className="ti ti-file-download" style={{ marginRight: 6 }} />Експорт PDF
          </button>
        </div>
      </div>

      {loading && <div style={{ fontSize: 13, color: '#5E5A6B' }}><i className="ti ti-loader" /> Рахуємо по {companies?.length || 0} компаніях…</div>}
      {err && <div style={{ ...CARD, color: '#C62828' }}>Помилка: {err}</div>}

      {data && t && (
        <>
          {/* Смуга рівняння */}
          <div style={{ background: '#17151F', color: '#fff', borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '14px 22px' }}>
              <EqPart label="Активи" value={t.assets} />
              <span style={{ fontSize: 24, color: '#8A849C' }}>=</span>
              <EqPart label="Зобов'язання" value={liabTotal} />
              <span style={{ fontSize: 24, color: '#8A849C' }}>+</span>
              <EqPart label="Власний капітал" value={t.equity} accent="#B9A2FF" />
            </div>
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 3 }}>
              <div style={{ width: barW(liabTotal, t.assets) + '%', background: '#FF7A6B' }} />
              <div style={{ width: barW(t.equity, t.assets) + '%', background: '#8B63FF' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#B9B4C9' }}>
              <span>Зобов'язання · {pct1(liabTotal / (t.assets || 1))} активів</span>
              <span>Капітал · {pct1(t.equity / (t.assets || 1))} активів</span>
            </div>
          </div>

          {/* Три картки */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            {/* Активи */}
            <div style={CARD}>
              <CardHead title="Активи (разом)" bg="#F1EEFB" color="#17151F" icon="ti-briefcase" />
              <div style={{ ...MONO, fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', color: numColor(t.assets) }}>{numText(t.assets)} ₴</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <BarRow label="Гроші" value={t.cash} total={t.assets} track="#F1EEFB" />
                <BarRow label="Склад" value={t.stock} total={t.assets} track="#F1EEFB" />
                <BarRow label="Дебіторка" value={t.recv} total={t.assets} track="#F1EEFB" />
                <BarRow label="Основні засоби" value={t.fa} total={t.assets} track="#F1EEFB" />
              </div>
              <ForecastFooter value={fAssets} delta={net} base={t.assets} />
            </div>

            {/* Зобов'язання */}
            <div style={CARD}>
              <CardHead title="Зобов'язання (разом)" bg="#FDEEEC" color="#B4291F" icon="ti-arrow-down" />
              <div style={{ ...MONO, fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', color: numColor(liabTotal) }}>{numText(liabTotal)} ₴</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <BarRow label="Кредиторка" value={t.pay} total={liabTotal} track="#FDEEEC" fill="#B4291F" />
                <BarRow label="Поворотна фін. допомога" value={t.loans} total={liabTotal} track="#FDEEEC" fill="#B4291F" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: '1px dashed #E3DFEC', fontSize: 13, color: '#5E5A6B' }}>
                  {rows.filter(r => r0(r.loans) !== 0).map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span>{r0(r.loans) > 0 ? `ПФД отримана · ${r.name}` : `ПФД видана · ${r.name} (нам повернуть)`}</span>
                      <span style={{ ...MONO, color: numColor(r.loans), fontWeight: r0(r.loans) < 0 ? 600 : 400 }}>{numText(r.loans)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <ForecastFooter value={liabTotal} delta={0} base={liabTotal} />
            </div>

            {/* Капітал */}
            <div style={CARD}>
              <CardHead title="Власний капітал (разом)" bg="#F1EEFB" color="#5B2FD6" icon="ti-diamond" />
              <div style={{ ...MONO, fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', color: numColor(t.equity, true) }}>{numText(t.equity)} ₴</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#5E5A6B', marginBottom: -6 }}>Чим забезпечений капітал</div>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
                <div style={{ width: barW(t.fa, t.equity) + '%', background: '#5B2FD6' }} />
                <div style={{ width: barW(t.cash, t.equity) + '%', background: '#A98CFF' }} />
                <div style={{ width: barW(otherNet, t.equity) + '%', background: '#DCD1FF' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
                <LegendRow dot="#5B2FD6" label="Основні засоби" value={t.fa} frac={t.fa / (t.equity || 1)} />
                <LegendRow dot="#A98CFF" label="Гроші" value={t.cash} frac={t.cash / (t.equity || 1)} />
                <LegendRow dot="#DCD1FF" label="Інші чисті активи" value={otherNet} frac={otherNet / (t.equity || 1)} />
              </div>
              <ForecastFooter value={fEquity} delta={net} base={t.equity} />
            </div>
          </div>

          {/* Об'єднана таблиця */}
          <div style={{ background: '#FFFFFF', border: '1px solid #ECEAF2', borderRadius: 20, padding: '24px 0 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '0 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Баланс по юрособах і прогноз</h2>
                <span style={{ fontSize: 13, color: '#5E5A6B' }}>Факт на кінець періоду, зліва направо — до прогнозу на {lastDayStr(year, month).split('-').reverse().join('.')}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#5E5A6B' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#FAF9FC', border: '1px solid #D9D5E5' }} />Факт</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#E6EBFF', border: '1px dashed #9AA8E8' }} />Прогноз</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="zb-bt">
                <thead>
                  <tr style={{ fontSize: 12, color: '#5E5A6B' }}>
                    <th style={{ fontWeight: 600, width: '22%' }}>Стаття</th>
                    {rows.map(r => <th key={r.id} style={{ fontWeight: 600 }}>{r.name}</th>)}
                    <th style={{ fontWeight: 800, color: '#17151F' }}>Разом · факт</th>
                    <th className="fc fcl" style={{ fontWeight: 600, color: '#2848C7' }}>Рух за прогнозом</th>
                    <th className="fc" style={{ fontWeight: 800, color: '#2848C7' }}>Прогноз {lastDayStr(year, month).slice(8)}.{lastDayStr(year, month).slice(5, 7)}</th>
                  </tr>
                </thead>
                <tbody>
                  <SecRow span={rows.length + 2} label="Активи" />
                  <StatRow rows={rows} field="cash" total={t.cash} label="Гроші"
                    move={<div><div style={{ color: '#1F7A4D' }}>+{absInt(income)}</div><div style={{ color: '#C62828', fontSize: 12 }}>−{absInt(expense)}</div></div>} fcVal={fCash} />
                  <StatRow rows={rows} field="stock" total={t.stock} label="Склад" move="—" fcVal={t.stock} />
                  <StatRow rows={rows} field="recv" total={t.recv} label="Дебіторка" move="—" fcVal={t.recv} />
                  <StatRow rows={rows} field="fa" total={t.fa} label="Основні засоби" move="—" fcVal={t.fa} />
                  <StatRow rows={rows} field="assets" total={t.assets} label="Активи разом" isTot moveNum={net} fcVal={fAssets} />

                  <SecRow span={rows.length + 2} label="Зобов'язання" />
                  <StatRow rows={rows} field="pay" total={t.pay} label="Кредиторка" move="—" fcVal={t.pay} />
                  <StatRow rows={rows} field="loans" total={t.loans} label="Поворотна фін. допомога" move="—" fcVal={t.loans} />
                  <StatRow rows={rows} fn={r => r0(r.pay) + r0(r.loans)} total={liabTotal} label="Зобов'язання разом" isTot move="—" fcVal={liabTotal} />

                  <SecRow span={rows.length + 2} label="Власний капітал" />
                  <StatRow rows={rows} field="equity" total={t.equity} label="Власний капітал" isTot big purple moveNum={net} fcVal={fEquity} />
                  <tr>
                    <td style={{ color: '#5E5A6B', fontSize: 13 }}>Частка у капіталі групи</td>
                    {rows.map(r => <td key={r.id} style={{ ...MONO, color: '#5E5A6B', fontSize: 13 }}>{pct1(r.equity / (t.equity || 1))}</td>)}
                    <td style={{ ...MONO, color: '#5E5A6B', fontSize: 13 }}>100%</td>
                    <td className="fc fcl" /><td className="fc" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </>
      )}
    </div>
  )
}

const selStyle = { height: 44, minWidth: 150, padding: '0 14px', border: '1px solid #DDD9E8', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 15, color: '#17151F' }

function EqPart({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#B9B4C9', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ ...MONO, fontSize: 26, fontWeight: 600, color: r0(value) < 0 ? '#FF7A6B' : (accent || '#fff') }}>{numText(value)} ₴</span>
    </div>
  )
}

function CardHead({ title, bg, color, icon }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5E5A6B' }}>{title}</span>
      <span style={{ width: 36, height: 36, borderRadius: 10, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i className={`ti ${icon}`} style={{ fontSize: 18 }} /></span>
    </div>
  )
}

function BarRow({ label, value, total, track, fill }) {
  const neg = r0(value) < 0
  const color = neg ? '#C62828' : (fill || '#17151F')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
        <span>{label}</span>
        <span style={{ ...MONO, color: numColor(value), fontWeight: neg ? 600 : 400 }}>{numText(value)}</span>
      </div>
      <div style={{ height: 6, background: track, borderRadius: 3 }}>
        <div style={{ width: barW(value, total) + '%', height: 6, background: color, borderRadius: 3 }} />
      </div>
    </div>
  )
}

function LegendRow({ dot, label, value, frac }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: dot }} />{label}</span>
      <span><span style={{ ...MONO, color: numColor(value) }}>{numText(value)}</span> <span style={{ color: '#5E5A6B', fontSize: 12 }}>{pct1(frac)}</span></span>
    </div>
  )
}

function ForecastFooter({ value, delta, base }) {
  return (
    <div style={{ marginTop: 'auto', background: '#F1F4FF', borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: '#2848C7' }}>
      <span style={{ fontWeight: 600 }}>Прогноз на кінець місяця</span>
      <span style={{ ...MONO, fontWeight: 600 }}>{numText(value)} ₴ · {changeText(delta, base)}</span>
    </div>
  )
}

function SecRow({ span, label }) {
  return <tr className="sec"><td colSpan={span}>{label}</td></tr>
}

// Рядок статті: per-company (field або fn) + Разом + рух прогнозу + прогноз
function StatRow({ rows, field, fn, total, label, isTot, big, purple, move, moveNum, fcVal }) {
  const val = (r) => fn ? fn(r) : r0(r[field])
  const fs = big ? 16 : undefined
  const cellColor = (v) => numColor(v, purple)
  return (
    <tr className={isTot ? 'tot' : undefined}>
      <td style={{ fontSize: fs }}>{label}</td>
      {rows.map(r => <td key={r.id} className="num" style={{ ...MONO, color: cellColor(val(r)), fontWeight: r0(val(r)) < 0 ? 600 : (isTot ? 700 : 400), fontSize: fs }}>{numText(val(r))}</td>)}
      <td className="num" style={{ ...MONO, color: cellColor(total), fontWeight: isTot ? 700 : 600, fontSize: fs }}>{numText(total)}</td>
      <td className="num fc fcl" style={{ ...MONO, fontSize: fs }}>
        {moveNum !== undefined
          ? <span style={{ color: r0(moveNum) < 0 ? '#C62828' : (r0(moveNum) > 0 ? '#1F7A4D' : '#A39FB0') }}>{r0(moveNum) > 0 ? '+' : ''}{numText(moveNum)}</span>
          : (move === '—' ? <span style={{ color: '#A39FB0' }}>—</span> : move)}
      </td>
      <td className="num fc" style={{ ...MONO, color: cellColor(fcVal), fontWeight: isTot ? 700 : 600, fontSize: fs }}>{numText(fcVal)}</td>
    </tr>
  )
}
