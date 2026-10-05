import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { TypePlanPreview } from './TypePlanPreview'
import { useTablePlan } from '../api/useTablePlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'
import type { TableActionRequest } from '../api/types'

export interface TableActionDialogProps {
  title: string
  /** Shown under the title, usually `keyspace.table`. */
  subtitle: string
  request: TableActionRequest
  /** Label of the confirming button. */
  applyLabel: string
  /** Style the button as destructive. */
  danger?: boolean
  /** Extra controls shown above the preview (for example a typed confirmation). */
  children?: ReactNode
  /** The button also stays disabled until this is true. */
  confirmed?: boolean
  /** Called after the statement ran successfully. */
  onApplied: () => void
  onClose: () => void
}

/**
 * Confirm dialog for one table change. It previews the server-planned statement and notes live, and runs
 * exactly that statement through /query when the button is pressed (one statement per action). Planner
 * errors disable the button; execution errors appear inline and keep the dialog open. Mount only while open.
 */
export function TableActionDialog({ title, subtitle, request, applyLabel, danger, children, confirmed = true, onApplied, onClose }: TableActionDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const { plan, pending } = useTablePlan(profileId, request)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const apply = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    const err = await runDdl(plan.statement, request.keyspace)
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
    } else {
      onApplied()
      onClose()
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width="min(560px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} className={danger ? 'border-line' : undefined} disabled={!plan.statement || pending || !confirmed || running} onClick={() => void apply()}>
            {applyLabel}
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        {children}
        <TypePlanPreview plan={plan} pending={pending} />
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
