// KPI-плитка (ТЗ, розділ 2): назва 13, число 20–24/700, підпис 12. tone: neutral | warn | danger | brand.
// onClick — плитка стає кнопкою (перехід до операцій, з яких складається цифра).
export default function KpiTile({ label, value, hint, tone = 'neutral', onClick, icon, className }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`ui-kpi is-${tone}${onClick ? ' is-link' : ''}${className ? ' ' + className : ''}`} onClick={onClick}>
      <span className="ui-kpi-label">{icon && <i className={`ti ${icon}`} aria-hidden="true" />}{label}</span>
      <span className="ui-kpi-value">{value}</span>
      {hint && <span className="ui-kpi-hint">{hint}</span>}
    </Tag>
  )
}
