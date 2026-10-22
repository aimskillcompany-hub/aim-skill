// Темна hero-картка (ТЗ, розділ 2): головна цифра першою і найбільшою, пояснення підписом під нею.
//   label, value (рядок із formatAmount), unit ('₴'), tone 'pos' | 'neg' | 'plain' — колір цифри на темному;
//   equation [{ label, value, op? }] — рівняння «A − B = C» (op: '−' | '+' | '='); children — графік / шкала.
export default function HeroCard({ label, value, unit = '₴', tone = 'plain', hint, equation, aside, children }) {
  return (
    <section className="ui-hero">
      <div className="ui-hero-top">
        <div className="ui-hero-main">
          {label && <span className="ui-hero-label">{label}</span>}
          <div className={`ui-hero-value is-${tone}`}>{value}{unit && <span className="ui-hero-unit"> {unit}</span>}</div>
          {hint && <span className="ui-hero-hint">{hint}</span>}
        </div>
        {aside && <div className="ui-hero-aside">{aside}</div>}
      </div>
      {equation?.length > 0 && (
        <div className="ui-hero-eq">
          {equation.map((e, i) => (
            <div key={i} className="ui-hero-eq-item">
              {e.op && <span className="ui-hero-op" aria-hidden="true">{e.op}</span>}
              <span className="ui-hero-eq-text">
                <span className="ui-hero-eq-label">{e.label}</span>
                <span className="ui-hero-eq-value">{e.value}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {children}
    </section>
  )
}
