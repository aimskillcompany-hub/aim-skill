import Button from './Button'

// Порожній стан: значок, заголовок, пояснення і одна дія (без ілюстрацій).
export default function EmptyState({ icon = 'ti-inbox', title, text, action }) {
  return (
    <div className="ui-empty">
      <i className={`ti ${icon}`} aria-hidden="true" />
      <p className="ui-empty-title">{title}</p>
      {text && <p className="ui-empty-text">{text}</p>}
      {action && <Button variant="secondary" icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}
