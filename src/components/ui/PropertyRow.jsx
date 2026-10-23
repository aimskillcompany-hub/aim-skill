// Рядок властивості: підпис ліворуч, значення праворуч. Якщо є onEdit — значення стає кнопкою з сірим фоном при наведенні.
export default function PropertyRow({ label, value, onEdit, empty = '—', children }) {
  const content = children ?? ((value === null || value === undefined || value === '') ? <span className="ui-muted">{empty}</span> : value)
  return (
    <div className="ui-prop-row">
      <span className="ui-prop-label">{label}</span>
      {onEdit
        ? <button type="button" className="ui-prop-value is-editable" onClick={onEdit}>{content}</button>
        : <div className="ui-prop-value">{content}</div>}
    </div>
  )
}
