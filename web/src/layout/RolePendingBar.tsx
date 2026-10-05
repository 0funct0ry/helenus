import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useApplyRole, previewRole } from '../api/useRoles'
import { useWorkspace } from '../store/workspace'
import type { RoleRequest } from '../api/types'

export interface PendingPermission {
  /** `resourceKey|PERMISSION`. */
  key: string
  request: RoleRequest
}

export interface RolePendingBarProps {
  items: PendingPermission[]
  onDiscard: () => void
  /** Called with the keys that were applied, also when a later one failed. */
  onApplied: (keys: string[]) => void
}

/**
 * Bar listing pending GRANT/REVOKE toggles with Discard, Review CQL and Apply. Review opens a dialog with the
 * server-rendered statements. Apply runs them one by one through /roles/apply and stops at the first failure, which is
 * shown inline; statements already applied are removed from the pending set. Renders nothing when empty.
 */
export function RolePendingBar({ items, onDiscard, onApplied }: RolePendingBarProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const apply = useApplyRole(profileId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<string[] | null>(null)
  if (items.length === 0) return null

  const openReview = async () => {
    const out: string[] = []
    for (const it of items) {
      try {
        const p = await previewRole(profileId, it.request)
        out.push(p.statement || p.errors[0]?.message || '')
      } catch (e) {
        out.push(e instanceof Error ? e.message : String(e))
      }
    }
    setReview(out)
  }
  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const done: string[] = []
    for (const it of items) {
      const err = await apply(it.request)
      if (err) {
        setError(err)
        break
      }
      done.push(it.key)
    }
    setBusy(false)
    if (done.length) onApplied(done)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-elevated px-3 py-2">
      <span>
        {items.length} pending permission {items.length === 1 ? 'change' : 'changes'}
      </span>
      {error && (
        <p role="alert" className="m-0 text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <div className="flex-1" />
      <Button onClick={onDiscard} disabled={busy}>
        Discard
      </Button>
      <Button onClick={() => void openReview()} disabled={busy}>
        Review CQL
      </Button>
      <Button variant="primary" onClick={() => void run()} disabled={busy}>
        Apply changes
      </Button>
      {review && (
        <Dialog open onClose={() => setReview(null)} title="Review CQL" width="min(640px, 94vw)" footer={<Button onClick={() => setReview(null)}>Close</Button>}>
          <pre aria-label="Statements" className="m-3 whitespace-pre-wrap rounded-md border border-line2 bg-editor p-3 font-mono text-[12.5px] leading-5">
            {review.join('\n')}
          </pre>
        </Dialog>
      )}
    </div>
  )
}
