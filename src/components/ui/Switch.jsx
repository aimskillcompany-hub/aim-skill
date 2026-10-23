// Перемикач «так / ні» з видимим підписом (замість чекбоксів із запереченням на кшталт «Не показувати…»).
//   checked, onChange(bool), label, description?, disabled
export default function Switch({ checked, onChange, label, description, disabled = false, id }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} disabled={disabled} id={id}
      className={`ui-switch${checked ? ' is-on' : ''}`} onClick={() => onChange?.(!checked)}>
      <span className="ui-switch-track" aria-hidden="true"><span className="ui-switch-knob" /></span>
      <span className="ui-switch-text">
        <span className="ui-switch-label">{label}</span>
        {description && <span className="ui-switch-desc">{description}</span>}
      </span>
    </button>
  )
}
