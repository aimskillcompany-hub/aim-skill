const STYLES = {
  income:   { background: '#EFF5EF', color: '#4A7C59' },
  expense:  { background: '#F5EDED', color: '#9B3A3A' },
  other:    { background: '#F0F2F5', color: '#6B6B6B' },
  info:     { background: '#EFF4FF', color: '#2563EB' },
  transfer: { background: '#F0F2F5', color: '#6B6B6B' },
}

const DIR_MAP = {
  'Доходи': 'income',
  'Витрати': 'expense',
  'ПФД': 'transfer',
  'Внутрішні перекази': 'transfer',
  'Відсотки банку': 'info',
  'Інше': 'other',
}

export function Badge({ type, label }) {
  const key = DIR_MAP[type] || type || 'other'
  const s = STYLES[key] || STYLES.other
  return (
    <span style={{
      ...s,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 12,
      fontWeight: 400,
      display: 'inline-flex',
      alignItems: 'center',
      whiteSpace: 'nowrap',
    }}>
      {label || type}
    </span>
  )
}

export default Badge
