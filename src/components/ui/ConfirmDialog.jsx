import Modal from './Modal'
import Button from './Button'

// Підтвердження дії (напр. пункту меню з confirm). danger — червона кнопка підтвердження (видалення, скасування).
export default function ConfirmDialog({ open, title = 'Підтвердіть дію', text, confirmLabel = 'Підтвердити', cancelLabel = 'Скасувати', danger = false, loading = false, onConfirm, onCancel }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}
      footer={<>
        <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'dark'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      {text && <p className="ui-confirm-text">{text}</p>}
    </Modal>
  )
}
