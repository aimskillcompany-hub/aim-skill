import { Link } from 'react-router-dom'

const ICON = { info: 'ti-info-circle', warn: 'ti-alert-triangle', danger: 'ti-alert-octagon', group: 'ti-arrows-exchange', brand: 'ti-circle-check' }

// Плашка (ТЗ, розділ 2): tone info | warn | danger | group | brand; іконка + жирний перший фрагмент + посилання-дія.
//   title — жирний початок, children / text — пояснення; action { label, to } або { label, onClick }.
export default function Callout({ tone = 'info', title, text, action, children, icon }) {
  return (
    <div className={`ui-callout is-${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
      <i className={`ti ${icon || ICON[tone] || ICON.info}`} aria-hidden="true" />
      <div className="ui-callout-body">
        {title && <strong>{title} </strong>}{text}{children}
      </div>
      {action && (action.to
        ? <Link className="ui-callout-action" to={action.to}>{action.label}</Link>
        : <button type="button" className="ui-callout-action" onClick={action.onClick}>{action.label}</button>)}
    </div>
  )
}
