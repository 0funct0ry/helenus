import { useEffect, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

export interface CountRowsDialogProps {
  open: boolean
  onClose: () => void
  /** Runs `SELECT COUNT(*)` and resolves to the count text. Called only after the user confirms. */
  onRun: () => Promise<string>
}

/**
 * Confirmation modal for Count rows. It first explains that counting reads every matching row (slow on
 * large tables), then runs the count on confirm and shows the number or the error in the same modal.
 */
export function CountRowsDialog({ open, onClose, onRun }: CountRowsDialogProps) {
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done' | 'error'>('confirm')
  const [text, setText] = useState('')

  useEffect(() => {
    if (open) setPhase('confirm')
  }, [open])

  const start = async () => {
    setPhase('running')
    try {
      setText(await onRun())
      setPhase('done')
    } catch (e) {
      setText(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Count rows"
      width="min(440px, 92vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>{phase === 'confirm' ? 'Cancel' : 'Close'}</Button>
          {phase === 'confirm' && (
            <Button variant="primary" onClick={() => void start()}>
              Count rows
            </Button>
          )}
        </>
      }
    >
      <div className="px-4 py-4 text-[13px]">
        {phase === 'confirm' && <p className="m-0">Counting runs SELECT COUNT(*) and reads every matching row. On a large table this can be slow and put load on the cluster. Continue?</p>}
        {phase === 'running' && <p className="m-0 text-muted">Counting…</p>}
        {phase === 'done' && (
          <p className="m-0">
            <span className="font-mono text-lg">{text}</span> rows match.
          </p>
        )}
        {phase === 'error' && <p className="m-0 text-danger">{text}</p>}
      </div>
    </Dialog>
  )
}
