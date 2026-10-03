import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { TypePlanPreview } from './TypePlanPreview'
import { useRunDdl } from '../api/useRunDdl'
import { useTypePlan } from '../api/useTypePlan'
import { useWorkspace } from '../store/workspace'

export interface DropTypeDialogProps {
  keyspace: string
  type: string
  /** Called after the type was dropped. */
  onDropped: () => void
  onClose: () => void
}

/**
 * Drop confirmation for a UDT. While anything uses the type the dialog lists the dependents and the Drop
 * button stays disabled; otherwise the user must type the type's name before Drop is enabled. The
 * statement comes from the server and runs through /query. Mount it only while open.
 */
export function DropTypeDialog({ keyspace, type, onDropped, onClose }: DropTypeDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const { plan, pending } = useTypePlan(profileId, { action: 'drop', keyspace, name: type })
  const [typed, setTyped] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inUse = plan.dependents.length > 0

  const drop = async () => {
    setRunning(true)
    const err = await runDdl(plan.statement, keyspace)
    setRunning(false)
    if (err) setError(err)
    else onDropped()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Drop type"
      subtitle={`${keyspace}.${type}`}
      width="min(520px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="border-line" disabled={!plan.statement || inUse || typed !== type || running} onClick={() => void drop()}>
            Drop type
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        {inUse ? (
          <>
            <p className="mt-0 text-[13px]">This type is still in use, so it cannot be dropped. Remove or change these first:</p>
            <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0 font-mono text-[12.5px]">
              {plan.dependents.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="mt-0 text-[13px]">Dropping a type cannot be undone. Type the name of the type to confirm.</p>
            <Field label={`Type "${type}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
          </>
        )}
        {!inUse && <TypePlanPreview plan={plan} pending={pending} />}
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
