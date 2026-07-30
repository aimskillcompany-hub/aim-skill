import { useRef, useLayoutEffect } from 'react'

// Textarea, що виглядає як інпут, але переносить довгий текст і авто-росте у висоту.
// Використовується для назв товарів та кодів, щоб значення показувались повністю.
export default function AutoTextarea({ value, onChange, style, onEnter, ...rest }) {
  const ref = useRef(null)
  const resize = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }
  useLayoutEffect(resize, [value])
  return (
    <textarea
      ref={ref}
      className="form-input"
      rows={1}
      value={value ?? ''}
      onChange={e => { onChange?.(e); resize() }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(e) } }}
      style={{ resize: 'none', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word', fontSize: 12.5, lineHeight: 1.35, ...style }}
      {...rest}
    />
  )
}
