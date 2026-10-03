import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Copy } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useChanges } from '../api/hooks'
import { describeError } from '../api/client'
import { flatten } from '../lib/changes'
import type { PendingItem } from '../lib/changes'
import type { ApplyResponse, ChangeResult, PreviewStatement } from '../api/types'
import { cn } from '../lib/cn'

export interface ReviewChangesDialogProps {
  open: boolean
  onClose: () => void
  profile: string
  keyspace: string
  table: string
  consistency: string
  /** The staged edits being reviewed, in apply order. */
  items: PendingItem[]
  /**
   * Called with the response of each apply, so the caller can drop what was applied, keep the rest
   * staged and refetch the page. The dialog closes itself when every change was applied.
   */
  onApplied: (res: ApplyResponse) => void
  /** Removes the staged changes that failed, so the ones behind them can be applied. */
  onDropFailed?: () => void
}

const STATUS: Record<ChangeResult['status'], string> = { applied: 'Applied', failed: 'Failed', pending: 'Not run' }

/**
 * Shows the staged edits as the literal-rendered CQL the server compiled for them (the statements run as
 * bound prepared statements; this text is only a preview). Apply runs them one at a time at the tab's
 * consistency and stops at the first failure. Afterwards each change shows its status, and the failed one
 * shows its error inline; the failed change and those after it stay staged.
 */
export function ReviewChangesDialog({ open, onClose, profile, keyspace, table, consistency, items, onApplied, onDropFailed }: ReviewChangesDialogProps) {
  const api = useChanges(profile)
  const [stmts, setStmts] = useState<PreviewStatement[]>([])
  const [results, setResults] = useState<ChangeResult[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const applied = useRef(false)

  const request = () => ({ keyspace, table, consistency, changes: flatten(items).map((f) => f.change) })

  // Compile a fresh preview each time the dialog opens or the staged edits change underneath it.
  useEffect(() => {
    if (!open || items.length === 0) return
    if (applied.current) return
    let live = true
    setError('')
    api
      .preview(request())
      .then((s) => live && setStmts(s))
      .catch((e: unknown) => live && (setStmts([]), setError(describeError(e))))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, api])

  useEffect(() => {
    if (!open) {
      applied.current = false
      setResults(null)
      setStmts([])
      setError('')
    }
  }, [open])

  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      const fresh = await api.preview(request())
      const res = await api.apply(request())
      setStmts(fresh)
      setResults(res.results)
      applied.current = true
      onApplied(res)
      if (res.failed_at < 0) onClose()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  const failedIndex = results?.findIndex((r) => r.status === 'failed') ?? -1

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Review ${stmts.length || items.length} ${(stmts.length || items.length) === 1 ? 'change' : 'changes'}`}
      subtitle={`Runs one statement at a time at ${consistency}`}
      width="min(760px, 94vw)"
      footer={
        <>
          <span className="flex-1 text-xs text-muted">Values are sent as bound parameters. The text above is a preview.</span>
          <Button icon={<Copy size={13} />} disabled={!stmts.length} onClick={() => void navigator.clipboard?.writeText(stmts.map((s) => s.preview).join('\n'))}>
            Copy
          </Button>
          {failedIndex >= 0 && onDropFailed && (
            <Button
              variant="danger"
              onClick={() => {
                applied.current = false
                setResults(null)
                onDropFailed()
              }}
            >
              Discard failed change
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<Check size={14} />} disabled={busy || !stmts.length || items.length === 0} onClick={() => void apply()}>
            {failedIndex >= 0 ? 'Retry remaining' : 'Apply changes'}
          </Button>
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto bg-editor">
        {error && (
          <p role="alert" className="m-3 flex items-start gap-2 rounded-md bg-err-bg px-3 py-2 text-[12.5px] text-danger">
            <AlertCircle size={14} className="mt-0.5 flex-none" />
            {error}
          </p>
        )}
        {!error && !stmts.length && <p className="p-4 text-muted">Compiling…</p>}
        <ol className="m-0 list-none p-0">
          {stmts.map((s, i) => {
            const r = results?.[i]
            return (
              <li key={s.index} className="border-b border-line2 px-4 py-2.5 font-mono text-[12.5px] leading-5">
                <div className="flex items-center gap-2 text-dim">
                  <span>{`-- ${i + 1} of ${stmts.length} · ${s.summary}`}</span>
                  {r && (
                    <span className={cn('rounded px-1.5 text-[11px] font-sans', r.status === 'applied' && 'bg-ok-bg text-ok', r.status === 'failed' && 'bg-err-bg text-danger', r.status === 'pending' && 'bg-selected text-muted')}>
                      {STATUS[r.status]}
                    </span>
                  )}
                </div>
                <pre className="m-0 whitespace-pre-wrap break-words font-mono">{s.preview}</pre>
                {r?.error && (
                  <p role="alert" className="m-0 mt-1 font-sans text-xs text-danger">
                    {r.error.message}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </Dialog>
  )
}
