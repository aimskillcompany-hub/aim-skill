import ContractorSelect from '../ui/ContractorSelect'
import ItemsTable from './ItemsTable'

const DIRECTIONS = ['Витрати', 'Доходи', 'ПФД', 'Внутрішні перекази', 'Відсотки банку', 'Інше']
const DOC_ROLES = ['incoming', 'outgoing']
const DOC_ROLE_LABELS = { incoming: 'Вхідний (від постачальника)', outgoing: 'Вихідний (від нас)' }

export default function DocForm({ form, articles, projects, groupByType, TYPE_LABELS, onUpdate, onContractorSelect, onUpdateItem }) {
  const set = (k) => (e) => onUpdate(k, e.target.value)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Дата</label>
          <input type="date" className="form-input" style={{ height: 34, fontSize: 12 }} value={form.date || ''} onChange={set('date')} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Тип документу</label>
          <input className="form-input" style={{ height: 34, fontSize: 12 }} value={form.docType || ''} onChange={set('docType')} placeholder="рахунок-фактура..." />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Контрагент</label>
          <ContractorSelect
            value={form.contractor || ''}
            onChange={v => onUpdate('contractor', v)}
            onContractorSelect={onContractorSelect}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>ЄДРПОУ</label>
          <input className="form-input" style={{ height: 34, fontSize: 12 }} value={form.edrpou || ''} onChange={set('edrpou')} placeholder="12345678" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Сума, грн</label>
          <input type="number" className="form-input" style={{ height: 34, fontSize: 12 }} value={form.total || ''} onChange={e => {
            const t = parseFloat(e.target.value) || 0
            const v = Math.round(t / 6 * 100) / 100
            onUpdate('total', e.target.value)
            onUpdate('vat', v.toString())
            onUpdate('noVat', (t - v).toFixed(2))
          }} placeholder="0.00" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Номер документу</label>
          <input className="form-input" style={{ height: 34, fontSize: 12 }} value={form.docNumber || ''} onChange={set('docNumber')} placeholder="НМ-001234" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Напрям</label>
          <select className="form-input" style={{ height: 34, fontSize: 12, padding: '4px 8px' }} value={form.direction || 'Витрати'} onChange={set('direction')}>
            {DIRECTIONS.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Стаття</label>
          <select className="form-input" style={{ height: 34, fontSize: 12, padding: '4px 8px' }} value={form.article || ''} onChange={set('article')}>
            <option value="">— оберіть —</option>
            {Object.entries(groupByType(articles)).map(([type, items]) =>
              items.length > 0 ? (
                <optgroup key={type} label={TYPE_LABELS[type]}>
                  {items.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                </optgroup>
              ) : null
            )}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Тип документу</label>
          <select className="form-input" style={{ height: 34, fontSize: 12, padding: '4px 8px' }} value={form.docRole || 'incoming'} onChange={set('docRole')}>
            {DOC_ROLES.map(r => <option key={r} value={r}>{DOC_ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Проєкт</label>
          <select className="form-input" style={{ height: 34, fontSize: 12, padding: '4px 8px' }} value={form.projectId || ''} onChange={set('projectId')}>
            <option value="">— без проєкту —</option>
            {(projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, display: 'block' }}>Призначення</label>
          <input className="form-input" style={{ height: 34, fontSize: 12 }} value={form.description || ''} onChange={set('description')} placeholder="Короткий опис" />
        </div>
      </div>

      <ItemsTable items={form.items} onUpdateItem={onUpdateItem} />
    </div>
  )
}
