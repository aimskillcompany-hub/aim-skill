// Картка задачі — новий інтерфейс (ТЗ редизайну 4.2; макети Tasks / TaskMobile). Лише показ: стан, обробники й
// перевірки прав — з TaskPanel у Tasks.jsx (передаються в x). Підзадачі — той самий компонент Subtasks.
import { Link } from 'react-router-dom'
import { STATUS, PRIORITY, RESULT, ACTIVE, personName, initials, shortDate, kyivTime, describeActivity, updateTask, addWatcher, removeWatcher, deleteTask, remindMe } from '../lib/tasks'
import { Button, Menu, InfoTip } from '../components/ui'
import { useState } from 'react'

const STEPS = ['new', 'in_progress', 'review', 'done']
const Av = ({ p, size = 28 }) => <span className="tpn-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} title={personName(p)}>{p ? initials(p) : '?'}</span>
const when = (iso) => iso ? `${shortDate(String(iso).slice(0, 10))}, ${kyivTime(iso)}` : ''

export default function TaskPanelNew({ x }) {
  const { t, P, me, people, canEdit, isCreator, isAssignee, isAdmin, busy, run, form, setForm, draft, setDraft, rtype, setRtype, submit, giveBack,
    changeStatus, duplicate, copyLink, onEdit, onClose, comments, history, cmt, setCmt, sendComment, tab, setTab, desc, recon, due, subtasks, inline } = x
  const [addW, setAddW] = useState(false)
  const [remAt, setRemAt] = useState(null)
  const cur = STEPS.indexOf(t.status)
  const offs = t.remind_offsets || [1440, 60]
  const toggleRem = (m) => run(() => updateTask(t.id, { remind_offsets: offs.includes(m) ? offs.filter(v => v !== m) : [...offs, m].sort((a, b) => b - a) }),
    offs.includes(m) ? 'Нагадування вимкнено' : 'Нагадування увімкнено — прийде в додаток і Telegram')

  // головна дія за статусом — поруч із перемикачем статусів
  let primary = null, secondary = null
  if (t.status === 'new' && (isAssignee || isCreator)) primary = <Button variant="primary" disabled={busy} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), 'Задачу взято в роботу')}>Взяти в роботу</Button>
  if (t.status === 'in_progress' && (isAssignee || isCreator) && form !== 'result') primary = <Button variant="primary" disabled={busy} onClick={() => { setForm('result'); setDraft(t.result_text || ''); setRtype(t.result_type || 'full') }}>Здати результат</Button>
  if (t.status === 'review' && isCreator) {
    primary = <Button variant="brand" disabled={busy} onClick={() => run(() => updateTask(t.id, { status: 'done' }), 'Результат прийнято')}>Прийняти</Button>
    secondary = <Button variant="secondary" disabled={busy} onClick={() => { setForm('return'); setDraft('') }}>Повернути</Button>
  }
  if (['done', 'on_hold', 'cancelled'].includes(t.status) && canEdit) secondary = <Button variant="secondary" disabled={busy} onClick={() => run(() => updateTask(t.id, { status: 'in_progress' }), t.status === 'done' ? 'Відкрито знову' : 'Відновлено')}>{t.status === 'done' ? 'Відкрити знову' : 'Відновити'}</Button>

  const link = t.entity_type === 'order' && t.entity_id ? { to: `/orders/${t.entity_id}`, icon: 'ti-shopping-cart', label: `№${t.order?.order_number || t.entity_id.slice(0, 6)}${t.order?.contractors?.name ? ` · ${t.order.contractors.name}` : ''}` }
    : t.entity_type === 'counterparty' && t.entity_id ? { to: `/contractors/${t.entity_id}`, icon: 'ti-users', label: t.counterparty?.name || 'Контрагент' }
    : recon ? { to: recon, icon: 'ti-arrows-exchange', label: 'Звірка видаткових' } : null
  const prio = PRIORITY[t.priority] || PRIORITY.normal

  return (
    <div className="tpn">
      <div className="tpn-top">
        {!inline && <Button variant="ghost" iconOnly icon="ti-arrow-left" aria-label="Назад до задач" onClick={onClose} />}
        {link ? <Link to={link.to} className="tpn-chip"><i className={`ti ${link.icon}`} aria-hidden="true" />{link.label}</Link> : <span className="tpn-muted">Задача без прив'язки</span>}
        <span className="tpn-top-acts">
          <Menu trigger={<Button variant="ghost" iconOnly icon="ti-dots" aria-label="Більше дій" />} items={[
            canEdit && { label: 'Редагувати', icon: 'ti-pencil', onClick: onEdit },
            t.status === 'new' && (isAssignee || isCreator) && { label: 'Здати результат одразу', icon: 'ti-check', onClick: () => { setForm('result'); setDraft(''); setRtype('full') } },
            ACTIVE(t) && t.status !== 'on_hold' && canEdit && { label: 'Відкласти', icon: 'ti-player-pause', onClick: () => run(() => updateTask(t.id, { status: 'on_hold' }), 'Задачу відкладено') },
            { label: 'Скопіювати посилання', icon: 'ti-link', onClick: copyLink },
            { label: 'Дублювати', icon: 'ti-copy', onClick: duplicate },
            (isCreator || isAdmin) && { divider: true },
            (isCreator || isAdmin) && ACTIVE(t) && { label: 'Скасувати задачу', icon: 'ti-ban', danger: true, confirm: { title: 'Скасувати задачу?', confirmLabel: 'Скасувати задачу' }, onClick: () => run(() => updateTask(t.id, { status: 'cancelled' }), 'Задачу скасовано') },
            (isCreator || isAdmin) && { label: 'Видалити', icon: 'ti-trash', danger: true, confirm: { title: 'Видалити задачу назавжди?', text: 'Краще «Скасувати» — тоді лишиться історія.', confirmLabel: 'Видалити' }, onClick: () => run(async () => { await deleteTask(t.id); onClose() }, 'Задачу видалено') },
          ].filter(Boolean)} />
          <Button variant="ghost" iconOnly icon="ti-x" aria-label="Закрити задачу" onClick={onClose} />
        </span>
      </div>

      <div className="tpn-body">
        <div>
          <h1 className="tpn-title">{t.title}</h1>
          <p className="tpn-muted tpn-by">Поставив {personName(P(t.created_by))}{t.created_at ? ` · ${when(t.created_at)}` : ''}{t.source === 'bot' ? ' · з Telegram' : ''}</p>
        </div>

        <div className="tpn-status">
          <div className="tpn-seg" role="group" aria-label="Статус задачі">
            {STEPS.map((k, i) => (
              <button key={k} type="button" aria-pressed={i === cur} disabled={!canEdit || busy || i === cur} onClick={() => changeStatus(k)}
                title={canEdit && i !== cur ? `Перевести в «${STATUS[k].label}»` : undefined}>{STATUS[k].label}</button>
            ))}
          </div>
          {secondary}{primary}
        </div>
        {t.status === 'review' && !isCreator && <p className="tpn-note">Чекає на перевірку: {personName(P(t.created_by))}</p>}
        {['on_hold', 'cancelled'].includes(t.status) && <p className="tpn-note">{STATUS[t.status].label}</p>}

        {form && (
          <section className="tpn-form">
            <label htmlFor="tpn-res">{form === 'result' ? 'Результат виконання' : 'Що доопрацювати'}</label>
            <textarea id="tpn-res" className="form-input" rows={4} autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={form === 'result' ? 'Що зроблено, з яким результатом, що залишилось' : 'Коментар для відповідального'} />
            {form === 'result' && <div className="tpn-rtypes">{Object.entries(RESULT).map(([k, l]) => <button key={k} type="button" aria-pressed={rtype === k} onClick={() => setRtype(k)}>{l}</button>)}</div>}
            <div className="tpn-form-acts"><Button variant="ghost" onClick={() => setForm(null)}>Скасувати</Button>
              <Button variant="primary" disabled={busy} onClick={form === 'result' ? submit : giveBack}>{form === 'return' ? 'Повернути на доопрацювання' : t.requires_review && !isCreator ? 'Надіслати на перевірку' : 'Закрити задачу'}</Button></div>
          </section>
        )}
        {t.result_text && form !== 'result' && (
          <section className="tpn-result"><small>Результат{t.result_type ? ` · ${RESULT[t.result_type]}` : ''} · {personName(P(t.result_by))}{t.result_at ? `, ${when(t.result_at)}` : ''}</small><p>{t.result_text}</p></section>
        )}

        <div className="tpn-props">
          <div className="tpn-prop"><span>Відповідальний</span>
            <label className="tpn-val"><Av p={P(t.assignee_id)} size={26} /><b>{personName(P(t.assignee_id))}</b>
              {canEdit && <select aria-label="Відповідальний" disabled={busy} value={t.assignee_id || ''} onChange={e => run(() => updateTask(t.id, { assignee_id: e.target.value || null }), `Призначено: ${personName(P(e.target.value))}`)}>
                {!t.assignee_id && <option value="">—</option>}{people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}</select>}</label></div>
          <div className="tpn-prop"><span>Термін</span>
            <button type="button" className="tpn-val" onClick={canEdit ? onEdit : undefined} disabled={!canEdit}>
              {due ? <b>{due.main}{due.rel && <em className={due.late ? 'is-late' : 'is-soon'}> · {due.rel}</em>}</b> : <b className="tpn-muted">Без терміну</b>}</button></div>
          <div className="tpn-prop"><span>Пріоритет</span>
            <label className="tpn-val"><span className={`tpn-prio is-${t.priority || 'normal'}`}><i aria-hidden="true" />{prio.label}</span>
              {canEdit && <select aria-label="Пріоритет" disabled={busy} value={t.priority || 'normal'} onChange={e => run(() => updateTask(t.id, { priority: e.target.value }))}>
                {Object.entries(PRIORITY).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</label></div>
          <div className="tpn-prop"><span>Перевірка результату</span>
            <label className="tpn-val"><input type="checkbox" className="tpn-check" checked={!!t.requires_review} disabled={!isCreator || busy} onChange={e => run(() => updateTask(t.id, { requires_review: e.target.checked }))} />
              <b>{t.requires_review ? `Перевіряє ${personName(P(t.created_by))}` : 'Без перевірки'}</b></label></div>
          <div className="tpn-prop"><span>Спостерігачі</span>
            <div className="tpn-val tpn-watch">
              {t.watchers.map(w => <span key={w} className="tpn-w"><Av p={P(w)} size={26} />{canEdit && <button type="button" aria-label={`Прибрати ${personName(P(w))}`} onClick={() => run(() => removeWatcher(t.id, w))}>×</button>}</span>)}
              {canEdit && (addW ? <select autoFocus className="form-input" onBlur={() => setAddW(false)} onChange={e => { setAddW(false); e.target.value && run(() => addWatcher(t.id, e.target.value)) }}>
                <option value="">обрати…</option>{people.filter(p => !t.watchers.includes(p.id)).map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}</select>
                : <button type="button" className="tpn-add" aria-label="Додати спостерігача" onClick={() => setAddW(true)}>+</button>)}
            </div></div>
          <div className="tpn-prop"><span>Нагадування<InfoTip label="Нагадування">{t.due_at ? 'Нагадування надходять у додаток і Telegram відповідальному. Якщо задачу прострочено — щодня о 09:00.' : 'Задайте термін, щоб працювали нагадування до терміну.'}</InfoTip></span>
            <div className="tpn-val tpn-rem">
              {[[1440, 'за 24 год'], [60, 'за 1 год']].map(([m, l]) => <button key={m} type="button" aria-pressed={offs.includes(m)} disabled={!canEdit || busy || !t.due_at} onClick={() => toggleRem(m)}>{l}</button>)}
              <span className={t.due_at ? 'is-on' : ''}>у термін</span>
              {ACTIVE(t) && (remAt == null ? <button type="button" className="tpn-me" onClick={() => setRemAt('')}>+ мені…</button>
                : <span className="tpn-me-at"><input type="datetime-local" className="form-input" value={remAt} onChange={e => setRemAt(e.target.value)} autoFocus />
                  <Button size="sm" variant="secondary" disabled={!remAt || busy} onClick={() => run(() => remindMe(t.id, remAt), 'Нагадаю в додатку та Telegram').then(ok => ok && setRemAt(null))}>OK</Button></span>)}
            </div></div>
        </div>

        <section className="tpn-desc">
          <div className="tpn-h"><h2>Опис</h2>{canEdit && <button type="button" className="tpn-link" onClick={onEdit}>Редагувати</button>}</div>
          {desc ? <p>{desc}</p> : <p className="tpn-muted">Опису немає.</p>}
        </section>

        {subtasks}

        <section className="tpn-feed">
          <div className="tpn-tabs" role="tablist">
            {[['comments', `Коментарі${comments.length ? ` · ${comments.length}` : ''}`], ['history', 'Історія']].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>))}
          </div>
          {tab === 'comments' ? <>
            {comments.map(c => <div key={c.id} className="tpn-c"><Av p={P(c.who)} size={32} /><div><small><b>{personName(P(c.who))}</b> · {when(c.created_at)}</small><p>{c.body}</p></div></div>)}
            <div className="tpn-c"><Av p={P(me)} size={32} />
              <div className="tpn-box">
                <textarea value={cmt} onChange={e => setCmt(e.target.value)} rows={3} placeholder="Напишіть коментар… @ — згадати колегу" aria-label="Коментар"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComment() } }} />
                <div><Button variant="primary" size="sm" disabled={!cmt.trim() || busy} onClick={sendComment}>Надіслати</Button></div>
              </div></div>
          </> : <ol className="tpn-hist">
            {history.map(h => <li key={h.id}><b>{h.who ? personName(P(h.who)) : 'Система'}</b> {describeActivity(h, people)} <span className="tpn-muted">· {when(h.created_at)}</span></li>)}
            {!history.length && <li className="tpn-muted">Історії ще немає.</li>}
          </ol>}
        </section>
      </div>
    </div>
  )
}
