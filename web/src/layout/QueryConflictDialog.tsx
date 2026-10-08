import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'

export interface QueryConflictDialogProps {
  /** Full name of the query that was changed elsewhere. */
  name: string
  /** Save again over the newer version. */
  onOverwrite: () => void
  /** Open Save as with "<name> copy". */
  onSaveAsCopy: () => void
  /** Replace the tab text with the saved text (called after the confirm). */
  onReload: () => void
  onCancel: () => void
}

/**
 * "This query was changed elsewhere" modal shown when a save answers a version conflict. Offers Overwrite, Save as
 * copy, Reload (which first asks to discard local edits) and Cancel. Cancel has initial focus.
 */
export function QueryConflictDialog({ name, onOverwrite, onSaveAsCopy, onReload, onCancel }: QueryConflictDialogProps) {
  const [confirmReload, setConfirmReload] = useState(false)
  return (
    <>
      <Dialog
        open
        onClose={onCancel}
        title="This query was changed elsewhere"
        width="min(460px, 92vw)"
        footer={
          <>
            <div className="flex-1" />
            <Button autoFocus onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" className="border-line" onClick={() => setConfirmReload(true)}>
              Reload
            </Button>
            <Button onClick={onSaveAsCopy}>Save as copy</Button>
            <Button variant="primary" onClick={onOverwrite}>
              Overwrite
            </Button>
          </>
        }
      >
        <p className="m-0 px-4 py-4 text-[13px]">
          <span className="font-mono">{name}</span> was saved by another tab or session after you opened it. Choose what to do with your version.
        </p>
      </Dialog>
      <ConfirmDialog
        open={confirmReload}
        title="Reload the saved text?"
        message="Your edits in this tab will be replaced by the saved text and lost."
        confirmLabel="Reload"
        danger
        onConfirm={() => {
          setConfirmReload(false)
          onReload()
        }}
        onCancel={() => setConfirmReload(false)}
      />
    </>
  )
}
