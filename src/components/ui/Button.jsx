import { forwardRef } from 'react'

const VARIANT = { primary: 'btn-primary', brand: 'btn-brand', dark: 'btn-dark', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' }

// Кнопка дизайн-системи (класи .btn у base.css).
//   variant: primary (головна дія; у новому інтерфейсі — ink) | brand (зелена) | dark (підтвердження у формах) | secondary | ghost | danger
//   size: md (38 px) | sm (32 px); на дотикових екранах — не менше 44 px
//   icon — клас Tabler ('ti-plus'); iconOnly — лише іконка (тоді обов'язковий aria-label); loading — спінер і disabled
const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon, iconOnly = false, loading = false, disabled, type = 'button', className = '', children, ...rest }, ref) {
  if (iconOnly && !rest['aria-label'] && import.meta.env?.DEV) console.warn('[Button] iconOnly без aria-label')
  const cls = ['btn', VARIANT[variant] || VARIANT.secondary, size === 'sm' && 'btn-sm', iconOnly && 'btn-icon', loading && 'is-loading', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon && <i className={`ti ${icon}`} aria-hidden="true" />}
      {!iconOnly && children}
    </button>
  )
})
export default Button
