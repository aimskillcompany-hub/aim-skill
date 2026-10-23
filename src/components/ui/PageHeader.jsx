import { Link } from 'react-router-dom'
import Button from './Button'
import Menu from './Menu'

// Шапка сторінки / запису.
//   crumbs [{ label, to, onClick }] (останній — поточна сторінка; onClick(e) може скасувати перехід через e.preventDefault()) або title;
//   subtitle — рядок або елементи;
//   primary { label, icon, onClick, loading } — синя головна дія; secondary — так само, біла;
//   menu — пункти для «⋯» (див. Menu)
export default function PageHeader({ title, crumbs, subtitle, primary, secondary, menu }) {
  return (
    <div className="page-header ui-page-header">
      <div className="ui-ph-left">
        {crumbs?.length
          ? <>
              <nav className="ui-crumbs" aria-label="Шлях">
                {crumbs.map((c, i) => c.to && i < crumbs.length - 1
                  ? <Link key={i} to={c.to} onClick={c.onClick}>{c.label}</Link>
                  : <span key={i} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>)}
              </nav>
              {title && <h1>{title}</h1>}
            </>
          : <h1>{title}</h1>}
        {subtitle && (typeof subtitle === 'string' ? <p>{subtitle}</p> : <div className="ui-ph-sub">{subtitle}</div>)}
      </div>
      <div className="ui-ph-actions">
        {secondary && <Button variant="secondary" icon={secondary.icon} onClick={secondary.onClick} loading={secondary.loading}>{secondary.label}</Button>}
        {primary && <Button variant="primary" icon={primary.icon} onClick={primary.onClick} loading={primary.loading}>{primary.label}</Button>}
        {menu?.length > 0 && <Menu items={menu} trigger={<Button variant="secondary" iconOnly icon="ti-dots" aria-label="Інші дії" />} />}
      </div>
    </div>
  )
}
