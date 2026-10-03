import { Check, Info } from 'lucide-react'
import { Button } from '../ui/Button'
import { summarize } from '../lib/changes'
import type { PendingItem } from '../lib/changes'

export interface PendingBarProps {
  /** The staged edits; the bar renders nothing when there are none. */
  items: PendingItem[]
  /** Message about the last apply that stopped at a failure. */
  failure?: string
  onDiscard: () => void
  onReview: () => void
  onApply: () => void
  /** Disables the buttons while an apply is running. */
  busy?: boolean
}

/**
 * The bar under the grid that appears while edits are staged: how many there are and of which kinds, then
 * Discard, Review CQL and Apply changes. After a failed apply it also shows what stopped it.
 */
export function PendingBar({ items, failure, onDiscard, onReview, onApply, busy }: PendingBarProps) {
  if (items.length === 0) return null
  const n = items.length
  return (
    <div role="status" className="flex flex-none flex-wrap items-center gap-2.5 border-t border-line bg-elevated px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <Info size={14} className="text-warn" />
        <b className="font-semibold">{n} pending {n === 1 ? 'change' : 'changes'}</b>
      </div>
      <span className="text-xs text-muted">{summarize(items)}</span>
      {failure && <span className="min-w-0 truncate text-xs text-danger" title={failure}>{failure}</span>}
      <div className="ml-auto flex gap-1.5">
        <Button variant="ghost" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
        <Button disabled={busy} onClick={onReview}>
          Review CQL
        </Button>
        <Button variant="primary" icon={<Check size={14} />} disabled={busy} onClick={onApply}>
          Apply changes
        </Button>
      </div>
    </div>
  )
}
