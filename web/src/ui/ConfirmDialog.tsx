import { Dialog } from './Dialog'
import { Button } from './Button'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** Explanation shown in the body. */
  message: string
  /** Label of the confirming button. */
  confirmLabel: string
  /** Style the confirming button as destructive. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A small confirmation modal built on Dialog, used instead of the native confirm(). Cancel is the default action. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      width="min(420px, 92vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} className={danger ? 'border-line' : undefined} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="m-0 px-4 py-4 text-[13px]">{message}</p>
    </Dialog>
  )
}
