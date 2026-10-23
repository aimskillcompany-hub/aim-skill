// Протоколи нарад — новий інтерфейс (ТЗ редизайну 5.2, 6.1; макет Protocols). Структуровані рішення про витрати —
// таблиця meeting_decisions (міграція 098, лише адміністратор). Старі текстові рішення й «Обговорення» лишаються як є.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCompany } from '../lib/company'
import { CATEGORIES, catOf, isMissingTable, listDecisions, createDecision, updateDecision, deleteDecision,
  groupAccountBalances, findPaymentCandidates, linkPayment } from '../lib/decisions'
import { formatAmount, plural } from '../utils/format'
import { todayKyiv } from '../lib/dates'
import { exportReportPdf } from '../lib/reportExport'
import { Button, Modal, Menu, Callout, EmptyState, TableSkeleton, useToast, InfoTip } from './ui'
import '../pages/Reports.css'
import './MeetingsNew.css'

const n0 = (v) => formatAmount(v, { decimals: 0 })
const dmy = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—'
const dm = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : ''
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']
const initials = (s) => (s || '').split(/[,;]/).map(x => x.trim()).filter(Boolean)

export default function MeetingsNew({ list, onEdit, onNew }) {
  const { companies } = useCompany()
  const toast = useToast()
  const [dec, setDec] = useState(null)
  const [mOpen, setMOpen] = useState(false)   // телефон: окремий екран наради (макет ProtocolsMobile)
  const [missing, setMissing] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [orders, setOrders] = useState({})
  const [cands, setCands] = useState({})
  const [sel, setSel] = useState(list[0]?.id || null)
  const [form, setForm] = useState(null)   // { protocol_id, …} для додавання / правки

  const minutesById = useMemo(() => Object.fromEntries(list.map(m => [m.id, m])), [list])
  const reload = () => listDecisions().then(d => { setDec(d); setMissing(false) }).catch(e => { if (isMissingTable(e)) { setMissing(true); setDec([]) } else { setDec([]); toast(e.message, { type: 'error' }) } })
  useEffect(() => { reload() }, [])
  useEffect(() => { if (companies?.length) groupAccountBalances(companies).then(setAccounts) }, [companies])
  useEffect(() => {
    if (!dec) return
    const ids = [...new Set(dec.flatMap(d => d.order_ids || []))]
    if (ids.length) supabase.from('orders').select('id, order_number').in('id', ids).then(({ data }) => setOrders(Object.fromEntries((data || []).map(o => [o.id, o.order_number]))))
    findPaymentCandidates(dec, minutesById).then(setCands)
  }, [dec])

  const accById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts])
  const cash = accounts.filter(a => a.is_active !== false).reduce((s, a) => s + a.balance, 0)
  const live = (dec || []).filter(d => d.status !== 'cancelled')
  const sum = (xs) => xs.reduce((s, d) => s + Number(d.amount || 0), 0)
  const approved = sum(live), paid = sum(live.filter(d => d.status === 'paid')), left = approved - paid
  const protos = new Set(live.map(d => d.protocol_id)).size

  const byMonth = useMemo(() => {
    const g = []
    list.forEach(m => { const k = (m.meeting_date || '').slice(0, 7); let b = g.find(x => x.k === k); if (!b) g.push(b = { k, items: [] }); b.items.push(m) })
    return g
  }, [list])
  const cur = minutesById[sel] || list[0]
  const curDec = (dec || []).filter(d => d.protocol_id === cur?.id)
  const curLive = curDec.filter(d => d.status !== 'cancelled')

  const togglePaid = async (d) => {
    try { await updateDecision(d.id, d.status === 'paid' ? { status: 'planned', paid_transaction_id: null } : { status: 'paid' }); reload() }
    catch (e) { toast(`Не змінено: ${e.message}`, { type: 'error' }) }
  }
  const link = async (d, t) => {
    try { await linkPayment(d.id, t.id); toast(`Рішення позначено сплаченим — платіж ${dmy(t.date)}`); reload() }
    catch (e) { toast(`Не прив'язано: ${e.message}`, { type: 'error' }) }
  }

  // PDF протоколу: рішення (категорія, кому, за що, з рахунку, сума, стан) + обговорення
  const exportPdf = (m) => {
    const ds = (dec || []).filter(d => d.protocol_id === m.id)
    const catLabel = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]))
    const rows = ds.map(d => ({
      cat: catLabel[d.category] || '', who: d.recipient || '—',
      what: (d.order_ids || []).length ? `за замовленнями ${(d.order_ids || []).map(id => '№' + (orders[id] || '…')).join(', ')}` : (d.note || ''),
      acc: accById[d.source_account_id]?.name || '—', amount: Number(d.amount) || 0,
      st: d.status === 'cancelled' ? 'скасовано' : d.status === 'paid' ? 'виплачено' : d.due_date ? `до ${dmy(d.due_date)}` : 'заплановано',
    }))
    const live = ds.filter(d => d.status !== 'cancelled')
    exportReportPdf({
      fileName: `Протокол наради ${dmy(m.meeting_date)}`, title: m.title || 'Протокол наради',
      subtitle: `Нарада ${dmy(m.meeting_date)}${m.participants ? ` · учасники: ${m.participants}` : ''} · ухвалено ${n0(sum(live))} ₴, виплачено ${n0(sum(live.filter(d => d.status === 'paid')))} ₴`,
      columns: [{ key: 'cat', label: 'Категорія' }, { key: 'who', label: 'Кому' }, { key: 'what', label: 'За що' }, { key: 'acc', label: 'З рахунку' }, { key: 'amount', label: 'Сума, ₴', num: true }, { key: 'st', label: 'Стан' }],
      rows, total: rows.length ? { cat: 'Разом', amount: sum(live) } : null,
      after: [
        { heading: 'Записані текстом', text: Array.isArray(m.decisions) ? m.decisions.map((x, i) => `${i + 1}. ${x.text}${x.owner ? ` — ${x.owner}` : ''}${x.due ? `, до ${dmy(x.due)}` : ''}`).join('\n') : '' },
        { heading: 'Обговорення', text: m.notes || '' },
      ],
    })
  }
  if (!list.length) return <EmptyState icon="ti-clipboard-text" title="Протоколів ще немає" text="Створіть першу нараду." action={{ label: 'Нова нарада', onClick: onNew }} />
  return (
    <div className="mtn">
      <div className="mtn-top">
        <h2 className="mtn-h">Протоколи нарад<InfoTip label="Протоколи нарад">Наради власників: на що й з якого рахунку витрачаємо гроші.</InfoTip></h2>
        <Button variant="primary" icon="ti-plus" onClick={onNew}>Нова нарада</Button>
      </div>
      {missing && <Callout tone="warn" title="Рішення про витрати ще не доступні" text="— потрібна міграція 098 (таблиця рішень). Протоколи й обговорення працюють як раніше." />}
      <div className="mtn-kpis">
        <div className="mtn-kpi is-dark"><span>Гроші групи зараз</span><b>{n0(cash)} ₴</b><small>на всіх рахунках {companies?.length || 0} {plural(companies?.length || 0, ['юрособи', 'юросіб', 'юросіб'])}</small></div>
        <div className="mtn-kpi"><span>Ухвалено витрат</span><b>{n0(approved)} ₴</b><small>у {live.length} {plural(live.length, ['рішенні', 'рішеннях', 'рішеннях'])} за {protos} {plural(protos, ['нараду', 'наради', 'нарад'])}</small></div>
        <div className="mtn-kpi"><span>Вже виплачено<InfoTip label="Вже виплачено">Позначено сплаченим — вручну або прив’язкою платежу з банку.</InfoTip></span><b className="is-pos">{n0(paid)} ₴</b></div>
        <div className="mtn-kpi is-warn"><span>Ще треба виплатити</span><b>{n0(left)} ₴</b><small>{cash > 0 ? `${Math.round((left / cash) * 100)}% грошей групи` : ''}</small></div>
      </div>

      <div className={`mtn-body${mOpen ? ' is-open' : ''}`}>
        <aside className="mtn-list" aria-label="Наради">
          {byMonth.map(b => (
            <Fragment key={b.k}>
              <div className="mtn-month">{b.k ? `${MONTHS[Number(b.k.slice(5, 7)) - 1]} ${b.k.slice(0, 4)}` : 'без дати'}</div>
              {b.items.map(m => {
                const ds = (dec || []).filter(d => d.protocol_id === m.id && d.status !== 'cancelled')
                const tot = sum(ds), pd = sum(ds.filter(d => d.status === 'paid')), np = ds.filter(d => d.status === 'paid').length
                const st = !ds.length ? ['Без рішень', ''] : np === ds.length ? ['Виконано', 'is-ok'] : np ? ['Частково', 'is-part'] : ['Не виконано', 'is-none']
                return (
                  <button key={m.id} type="button" className="mtn-card" aria-pressed={cur?.id === m.id} onClick={() => { setSel(m.id); setMOpen(true); window.scrollTo?.(0, 0) }}>
                    <span className="mtn-card-h"><small>{dmy(m.meeting_date)}{m.participants ? ` · ${m.participants}` : ''}</small><span className={`mtn-st ${st[1]}`}>{st[0]}</span></span>
                    <b className="mtn-card-t">{m.title}</b>
                    {ds.length > 0 && <>
                      <span className="mtn-card-sum">{n0(tot)} ₴</span>
                      <span className="mtn-prog" aria-hidden="true"><i style={{ width: `${tot ? (pd / tot) * 100 : 0}%` }} /></span>
                      <small className="rpt-muted">виплачено {n0(pd)} ₴ · {np} з {ds.length} рішень</small>
                    </>}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </aside>

        {cur && (
          <section className="cfn-card mtn-detail" aria-label={cur.title}>
            <button type="button" className="mtn-back" onClick={() => setMOpen(false)}><i className="ti ti-arrow-left" aria-hidden="true" />Усі наради</button>
            <div className="mtn-d-head">
              <div>
                <span className="rpt-muted">Нарада · {dmy(cur.meeting_date)}{initials(cur.participants).map(p => <span key={p} className="mtn-who">{p}</span>)}</span>
                <h2>{cur.title}</h2>
              </div>
              <div className="mtn-d-acts">
                <Button variant="secondary" icon="ti-pencil" onClick={() => onEdit(cur)}>Редагувати</Button>
                <Button variant="secondary" icon="ti-file-type-pdf" onClick={() => exportPdf(cur)} disabled={!dec}>PDF</Button>
              </div>
            </div>
            {curLive.length > 0 && (() => {
              const t = sum(curLive), p = sum(curLive.filter(d => d.status === 'paid'))
              return <>
                <div className="mtn-sum3">
                  <div><span>Вирішили витратити</span><b>{n0(t)} ₴</b></div>
                  <div className="is-paid"><span>Виплачено</span><b>{n0(p)} ₴</b></div>
                  <div className="is-left"><span>Залишилось виплатити</span><b>{n0(t - p)} ₴</b></div>
                </div>
                <div className="mtn-catbar" aria-hidden="true">{CATEGORIES.map(c => { const v = sum(curLive.filter(d => d.category === c.key)); return v > 0 && <span key={c.key} style={{ flexGrow: v, background: c.color }} /> })}</div>
                <ul className="mtn-catleg">{CATEGORIES.map(c => { const v = sum(curLive.filter(d => d.category === c.key)); return v > 0 && <li key={c.key}><i style={{ background: c.color }} />{c.label} <b>{n0(v)} ₴</b></li> })}</ul>
              </>
            })()}

            <div className="mtn-dec-h"><h3>Рішення: куди йдуть гроші<InfoTip label="Рішення: куди йдуть гроші">Позначка «виплачено» — кружком або прив’язкою знайденого платежу з банку.</InfoTip></h3></div>
            {!dec ? <TableSkeleton rows={3} cols={4} label="Завантаження рішень…" /> : CATEGORIES.map(c => {
              const ds = curDec.filter(d => d.category === c.key)
              if (!ds.length) return null
              return (
                <div key={c.key} className="mtn-group">
                  <div className="mtn-group-h"><span><i style={{ background: c.color }} />{c.label}</span><b>{n0(sum(ds.filter(d => d.status !== 'cancelled')))} ₴</b></div>
                  {ds.map(d => {
                    const acc = accById[d.source_account_id]
                    const cancelled = d.status === 'cancelled', isPaid = d.status === 'paid'
                    const late = !isPaid && !cancelled && d.due_date && d.due_date < todayKyiv()
                    return (
                      <div key={d.id} className={`mtn-dec${cancelled ? ' is-cancelled' : ''}`}>
                        <input type="checkbox" className="mtn-cb" checked={isPaid} disabled={cancelled} onChange={() => togglePaid(d)} aria-label={`Виплачено: ${d.recipient || ''} ${n0(d.amount)} ₴`} />
                        <div className="mtn-dec-main">
                          <b>{d.recipient || '—'}</b>
                          <small className="rpt-muted">{(d.order_ids || []).length ? <>за замовленнями {(d.order_ids || []).map(id => <span key={id} className="mtn-ord">№{orders[id] || '…'}</span>)}</> : (d.note || c.label.toLowerCase())}</small>
                          {(cands[d.id] || []).map(t => (
                            <span key={t.id} className="mtn-cand"><i className="ti ti-link" aria-hidden="true" />Знайдено платіж {dmy(t.date)} · {n0(t.amount)} ₴{t.counterparty ? ` · ${t.counterparty}` : ''}
                              <button type="button" onClick={() => link(d, t)}>Прив'язати</button></span>
                          ))}
                        </div>
                        <div className="mtn-dec-acc"><small>з рахунку</small><span>{acc ? `${acc.name}${acc.companyName && (companies?.length || 0) > 1 ? ` · ${acc.companyName}` : ''}` : '—'}</span></div>
                        <b className="mtn-dec-amt">{n0(d.amount)} ₴</b>
                        <span className={`mtn-pill ${cancelled ? '' : isPaid ? 'is-ok' : late ? 'is-late' : 'is-due'}`}>
                          {cancelled ? 'Скасовано' : isPaid ? `Виплачено${d.updated_at ? ' ' + dm(d.updated_at.slice(0, 10)) : ''}` : d.due_date ? `${late ? 'Прострочено' : 'Виплатити до'} ${dm(d.due_date)}` : 'Заплановано'}
                        </span>
                        <Menu trigger={<Button variant="ghost" size="sm" iconOnly icon="ti-dots" aria-label="Дії з рішенням" />} items={[
                          { label: 'Змінити', icon: 'ti-pencil', onClick: () => setForm({ ...d }) },
                          cancelled ? { label: 'Відновити', icon: 'ti-restore', onClick: () => updateDecision(d.id, { status: 'planned' }).then(reload) }
                            : { label: 'Скасувати рішення', icon: 'ti-ban', confirm: { title: 'Скасувати рішення?', text: 'Сума перестане враховуватись у «треба виплатити».', confirmLabel: 'Скасувати рішення' }, onClick: () => updateDecision(d.id, { status: 'cancelled', paid_transaction_id: null }).then(reload) },
                          { label: 'Видалити', icon: 'ti-trash', danger: true, confirm: { title: 'Видалити рішення?', text: 'Дію не можна скасувати.', confirmLabel: 'Видалити' }, onClick: () => deleteDecision(d.id).then(reload) },
                        ]} />
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {!missing && <button type="button" className="mtn-add" onClick={() => setForm({ protocol_id: cur.id, category: 'owner_payout', recipient: '', amount: '', source_account_id: '', due_date: '', note: '', order_ids: [] })}><i className="ti ti-plus" aria-hidden="true" />Додати рішення про витрату</button>}

            {Array.isArray(cur.decisions) && cur.decisions.length > 0 && (
              <div className="mtn-old"><h3>Записані текстом</h3>
                <ul>{cur.decisions.map((x, i) => <li key={i} className={x.done ? 'is-done' : ''}>{x.text}{x.owner ? ` — ${x.owner}` : ''}{x.due ? `, до ${dmy(x.due)}` : ''}</li>)}</ul></div>
            )}
            {cur.notes && <div className="mtn-notes"><h3>Обговорення</h3><p>{cur.notes}</p></div>}
          </section>
        )}
      </div>
      {form && <DecisionForm init={form} accounts={accounts} multi={(companies?.length || 0) > 1} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
    </div>
  )
}

function DecisionForm({ init, accounts, multi, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ ...init, amount: init.amount ? String(init.amount) : '', ordersText: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const acc = accounts.find(a => a.id === f.source_account_id)
  useEffect(() => {
    if (!init.order_ids?.length) return
    supabase.from('orders').select('order_number').in('id', init.order_ids).then(({ data }) => set('ordersText', (data || []).map(o => o.order_number).join(', ')))
  }, [])
  const save = async () => {
    const amount = Number(String(f.amount).replace(',', '.').replace(/\s/g, ''))
    if (!(amount > 0)) return setErr('Вкажіть суму')
    if (!f.recipient.trim()) return setErr('Вкажіть, кому або на що')
    setBusy(true); setErr(null)
    try {
      let order_ids = []
      const nums = f.ordersText.split(/[\s,;]+/).map(x => x.replace(/^№/, '').trim()).filter(Boolean)
      if (nums.length) {
        const { data } = await supabase.from('orders').select('id, order_number').in('order_number', nums)
        order_ids = (data || []).map(o => o.id)
        const miss = nums.filter(n => !(data || []).some(o => String(o.order_number) === n))
        if (miss.length) { setBusy(false); return setErr(`Не знайдено замовлень: ${miss.join(', ')}`) }
      }
      const row = { protocol_id: f.protocol_id, category: f.category, recipient: f.recipient.trim(), amount, source_account_id: f.source_account_id || null,
        due_date: f.due_date || null, note: f.note?.trim() || null, order_ids }
      if (f.id) await updateDecision(f.id, row); else await createDecision(row)
      toast(f.id ? 'Рішення змінено' : 'Рішення додано')
      onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open title={f.id ? 'Рішення про витрату' : 'Нове рішення про витрату'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button variant="primary" icon="ti-check" loading={busy} onClick={save}>Зберегти</Button></>}>
      <div className="form-grid">
        <div className="form-group"><label>Категорія</label>
          <select className="form-input" value={f.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
        <div className="form-group"><label>Сума, ₴ *</label><input className="form-input" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} /></div>
        <div className="form-group full"><label>Кому / на що *</label><input className="form-input" value={f.recipient} onChange={e => set('recipient', e.target.value)} placeholder="Напр. РВ, Валерія, агент С" /></div>
        <div className="form-group full"><label>З якого рахунку</label>
          <select className="form-input" value={f.source_account_id || ''} onChange={e => set('source_account_id', e.target.value)}>
            <option value="">—</option>
            {accounts.filter(a => a.is_active !== false).map(a => <option key={a.id} value={a.id}>{a.name}{multi ? ` · ${a.companyName}` : ''} — {n0(a.balance)} ₴</option>)}
          </select>
          {acc && <small className={Number(f.amount) > acc.balance ? 'rpt-late' : 'rpt-muted'}>Зараз на рахунку {n0(acc.balance)} ₴{Number(f.amount) > acc.balance ? ' — менше, ніж сума рішення' : ''}</small>}</div>
        <div className="form-group"><label>Строк</label><input type="date" className="form-input" value={f.due_date || ''} onChange={e => set('due_date', e.target.value)} /></div>
        {f.category === 'agent_fee' && <div className="form-group"><label>За замовленнями</label><input className="form-input" value={f.ordersText} onChange={e => set('ordersText', e.target.value)} placeholder="24, 27, 66" /></div>}
        <div className="form-group full"><label>Примітка</label><input className="form-input" value={f.note || ''} onChange={e => set('note', e.target.value)} /></div>
      </div>
      {err && <p className="rpt-late">{err}</p>}
    </Modal>
  )
}
