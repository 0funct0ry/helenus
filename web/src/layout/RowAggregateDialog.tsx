import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { aggregateRows } from '../api/rows'
import { describeError } from '../api/client'
import type { QueryColumn, RowsAggregateResponse } from '../api/types'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useToasts } from '../store/toast'

export interface RowAggregateDialogProps {
  open: boolean
  onClose: () => void
  profile: string
  /** The visible columns and the target rows (positional wire values) to aggregate. */
  columns: QueryColumn[]
  rows: unknown[][]
}

/**
 * The aggregate view of the row menu: ROWS, COLS, COUNT, COUNT_NUMS, SUM, AVG, MIN, MAX, MEDIAN and
 * COEFFICIENT_OF_VARIATION over every cell of the target rows, computed by the server with exact decimal
 * arithmetic and shown as an aligned monospace list. Figures that need numbers show a dash when there are
 * none. Copy puts the same `KEY: value` lines on the clipboard.
 */
export function RowAggregateDialog({ open, onClose, profile, columns, rows }: RowAggregateDialogProps) {
  const [res, setRes] = useState<RowsAggregateResponse | null>(null)
  const [error, setError] = useState('')
  const push = useToasts((s) => s.push)

  useEffect(() => {
    if (!open) return
    setRes(null)
    setError('')
    let live = true
    aggregateRows(profile, { columns, rows }).then(
      (r) => live && setRes(r),
      (e) => live && setError(describeError(e)),
    )
    return () => {
      live = false
    }
    // Compute once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const width = Math.max(0, ...(res?.lines.map((l) => l.key.length) ?? []))
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Aggregate view"
      subtitle={`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
      width="min(560px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button
            icon={<Copy size={12} />}
            disabled={!res}
            onClick={() => {
              if (!res) return
              navigator.clipboard?.writeText(res.text).then(
                () => push('Copied aggregate figures'),
                () => push('Copy failed: the clipboard is not available'),
              )
            }}
          >
            Copy
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="px-4 py-3">
        {error && <p role="alert" className="rounded-md bg-err-bg px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        {!res && !error && <p className="text-muted">Computing…</p>}
        {res && (
          <pre aria-label="Aggregate figures" className="m-0 whitespace-pre font-mono text-[12.5px] leading-6">
            {res.lines.map((l) => `${(l.key + ':').padEnd(width + 2)}${l.value}`).join('\n')}
          </pre>
        )}
      </div>
    </Dialog>
  )
}
