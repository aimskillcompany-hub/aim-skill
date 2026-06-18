import DocForm from './DocForm'

const fmt = n => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(n || 0)))

export default function DocCard({
  card, articles, projects, groupByType, TYPE_LABELS,
  expanded, onToggleExpand, onRemove, onSave, onUpdateForm, onUpdateItem,
  onContractorSelect, onLinkBank, saving
}) {
  const d = card.data
  const hasBankMatch = !!card.bankMatch

  return (
    <div style={{
      background: card.saved ? 'var(--green-bg)' : card.isDuplicate ? 'var(--surface2)' : 'var(--surface)',
      border: expanded ? '2px solid var(--blue)' : '1.5px solid var(--border)',
      borderRadius: 12, padding: 14, position: 'relative',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }} onClick={onToggleExpand}>
        <i className={`ti ${card.file.type === 'application/pdf' ? 'ti-file-type-pdf' : 'ti-photo'}`}
          style={{ fontSize: 20, color: card.saved ? 'var(--green)' : card.isDuplicate ? 'var(--amber)' : 'var(--blue)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.file.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{(card.file.size / 1024).toFixed(0)} KB</div>
        </div>
        {!card.saved && (
          <button onClick={e => { e.stopPropagation(); onRemove() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, padding: '0 2px' }}>×</button>
        )}
      </div>

      {/* Status badges */}
      {card.saved && (
        <div style={{ background: 'var(--green-bg)', color: 'var(--green)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 500, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="ti ti-check" style={{ fontSize: 13 }} /> Збережено
        </div>
      )}
      {hasBankMatch && (
        <div style={{ background: 'var(--green-bg)', color: 'var(--green)', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 500, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1 }}>
            🔗 {card.saved ? 'Привʼязано' : 'Буде привʼязано'}
            <div style={{ fontWeight: 400, marginTop: 2, fontSize: 11, color: 'var(--text2)' }}>
              {card.bankMatch.date} · {(card.bankMatch.counterparty || '').substring(0, 30)} · {fmt(Math.abs(card.bankMatch.amount))} грн
            </div>
          </div>
          {!card.saved && <button onClick={e => { e.stopPropagation(); onLinkBank() }}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text2)', fontSize: 11, padding: '2px 8px', fontFamily: 'inherit', flexShrink: 0 }}>Змінити</button>}
        </div>
      )}
      {card.isDuplicate && !card.saved && (
        <div style={{ background: 'var(--surface2)', color: 'var(--text2)', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
          ⚠ Можливий дублікат в пакеті
        </div>
      )}
      {card.status === 'error' && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 6, padding: '4px 10px', fontSize: 12, marginBottom: 8 }}>
          ✗ {card.error}
        </div>
      )}

      {/* Extracting */}
      {card.status === 'extracting' && (
        <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text2)', fontSize: 13 }}>
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          Розпізнаємо...
        </div>
      )}

      {/* Pending */}
      {card.status === 'pending' && !card.saved && (
        <div style={{ textAlign: 'center', padding: 8, color: 'var(--text3)', fontSize: 12 }}>
          Очікує розпізнавання
        </div>
      )}

      {/* Done — show data */}
      {card.status === 'done' && d && !card.saved && (
        <>
          {/* Compact summary */}
          {!expanded && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{d.contractor || '—'}</div>
              <div style={{ display: 'flex', gap: 10, color: 'var(--text2)', flexWrap: 'wrap' }}>
                {d.date && <span>{d.date}</span>}
                {d.totalAmount && <span style={{ fontWeight: 500, color: card.form.direction === 'Доходи' ? 'var(--green)' : 'var(--red)' }}>{fmt(d.totalAmount)} грн</span>}
                {d.docType && <span style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 6 }}>{d.docType}</span>}
                {d.docNumber && <span>№{d.docNumber}</span>}
              </div>
              {d.edrpou && <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 2 }}>ЄДРПОУ: {d.edrpou}</div>}
              {d.items?.length > 0 && (() => {
                const matched = d.items.filter(it => it._match?.matchType === 'exact' || it._match?.matchType === 'fuzzy').length
                const newItems = d.items.filter(it => !it._match || it._match.matchType === 'none').length
                return (
                  <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                    {matched > 0 && <span style={{ fontSize: 10, background: 'var(--green-bg)', color: 'var(--green)', padding: '1px 5px', borderRadius: 4 }}>✓ {matched} на складі</span>}
                    {newItems > 0 && <span style={{ fontSize: 10, background: 'var(--surface2)', color: 'var(--text3)', padding: '1px 5px', borderRadius: 4 }}>+ {newItems} нових</span>}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Expanded form */}
          {expanded && (
            <DocForm
              form={card.form}
              articles={articles}
              projects={projects}
              groupByType={groupByType}
              TYPE_LABELS={TYPE_LABELS}
              onUpdate={onUpdateForm}
              onContractorSelect={onContractorSelect}
              onUpdateItem={onUpdateItem}
            />
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', display: 'flex', gap: 6, fontSize: 13 }}
              onClick={onSave} disabled={saving}>
              <i className="ti ti-device-floppy" style={{ fontSize: 14 }} />
              {saving ? 'Збереження...' : 'Зберегти'}
            </button>
            {!hasBankMatch && (
              <button className="btn btn-secondary" style={{ justifyContent: 'center', display: 'flex', gap: 4, fontSize: 12 }}
                onClick={onLinkBank}>
                <i className="ti ti-link" style={{ fontSize: 13 }} />
              </button>
            )}
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={onToggleExpand}>
              <i className={`ti ti-chevron-${expanded ? 'up' : 'down'}`} style={{ fontSize: 13 }} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
