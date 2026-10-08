import { useEffect, useRef } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

export interface CloseTabsDialogProps {
  open: boolean
  /** Titles of the tabs that have unapplied grid changes or unsaved query edits (only these are listed). */
  titles: string[]
  onConfirm: () => void
  onCancel: () => void
}

const MAX_LISTED = 8

/**
 * Modal asking before tabs with unapplied grid changes or unsaved edits to a saved query are closed. Lists up to eight affected tab
 * titles ("and N more" beyond that). Cancel has initial focus; Enter confirms only while
 * "Discard and close" is focused. Escape, the scrim and Cancel dismiss without closing anything.
 */
export function CloseTabsDialog({ open, titles, onConfirm, onCancel }: CloseTabsDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) cancel.current?.focus()
  }, [open])
  const more = titles.length - MAX_LISTED
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Discard unapplied changes?"
      width="min(420px, 92vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button ref={cancel} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" className="border-line" onClick={onConfirm}>
            Discard and close
          </Button>
        </>
      }
    >
      <div className="px-4 py-4 text-[13px]">
        <p className="m-0">These tabs have unsaved or unapplied changes that will be lost:</p>
        <ul className="m-0 mt-2 list-disc pl-5">
          {titles.slice(0, MAX_LISTED).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
          {more > 0 && <li className="list-none text-muted">and {more} more</li>}
        </ul>
      </div>
    </Dialog>
  )
}
