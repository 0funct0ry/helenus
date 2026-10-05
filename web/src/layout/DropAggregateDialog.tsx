import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { TypePlanPreview } from './TypePlanPreview'
import { useAggregatePlan } from '../api/useAggregatePlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'
import type { Agg } from '../lib/schemaModel'

export interface DropAggregateDialogProps {
  aggregate: Agg
  /** Called after the aggregate was dropped. */
  onDropped: () => void
  onClose: () => void
}

/**
 * Drop confirmation for one aggregate overload. The server plans `DROP AGGREGATE ks.a(types)`; the user must type
 * the aggregate's name before Drop is enabled. Mount it only while open.
 */
export function DropAggregateDialog({ aggregate, onDropped, onClose }: DropAggregateDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const { plan, pending } = useAggregatePlan(profileId, { action: 'drop', keyspace: aggregate.keyspace, name: aggregate.name, arg_types: aggregate.argTypes })
  const [typed, setTyped] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = plan.errors.length > 0

  const drop = async () => {
    if (running) return
    setRunning(true)
    const err = await runDdl(plan.statement, aggregate.keyspace)
    if (err) {
      setRunning(false)
      setError(err)
    } else onDropped()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Drop aggregate"
      subtitle={`${aggregate.keyspace}.${aggregate.signature}`}
      width="min(520px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="border-line" disabled={!plan.statement || blocked || pending || typed !== aggregate.name || running} onClick={() => void drop()}>
            Drop aggregate
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        {!blocked && (
          <>
            <p className="mt-0 text-[13px]">Dropping an aggregate cannot be undone; its state and final functions are kept. Type the name of the aggregate to confirm.</p>
            <Field label={`Type "${aggregate.name}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
          </>
        )}
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
