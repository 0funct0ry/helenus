import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

export interface UnsavedQueryDialogProps {
  /** Title of the dirty tab being closed, e.g. `daily.cql`. */
  title: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * "Save changes to daily.cql?" modal shown when a dirty bound query tab is closed with its X button or the Delete key.
 * Save writes the tab to the library and closes it; Don't save closes it and drops the edits; Cancel (also Escape)
 * keeps the tab open. Save has initial focus.
 */
export function UnsavedQueryDialog({ title, onSave, onDiscard, onCancel }: UnsavedQueryDialogProps) {
  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Save changes to ${title}?`}
      width="min(420px, 92vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" className="border-line" onClick={onDiscard}>
            Don’t save
          </Button>
          <Button variant="primary" autoFocus onClick={onSave}>
            Save
          </Button>
        </>
      }
    >
      <p className="m-0 px-4 py-4 text-[13px]">Your changes will be lost if you don’t save them.</p>
    </Dialog>
  )
}
