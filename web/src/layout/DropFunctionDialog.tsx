import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { TypePlanPreview } from './TypePlanPreview'
import { useFunctionPlan } from '../api/useFunctionPlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'
import type { Fn } from '../lib/schemaModel'

export interface DropFunctionDialogProps {
  fn: Fn
  /** Called after the function was dropped. */
  onDropped: () => void
  onClose: () => void
}

/**
 * Drop confirmation for one function overload. The server plans `DROP FUNCTION ks.f(types)`; when an aggregate
 * still uses the function the plan carries an error naming it, shown above the statement, and Drop stays
 * disabled. Otherwise the user must type the function's name first. Mount it only while open.
 */
export function DropFunctionDialog({ fn, onDropped, onClose }: DropFunctionDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const request = { action: 'drop' as const, keyspace: fn.keyspace, name: fn.name, args: fn.argTypes.map((type, i) => ({ name: fn.argNames[i] ?? `a${i}`, type })) }
  const { plan, pending } = useFunctionPlan(profileId, request)
  const [typed, setTyped] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = plan.errors.length > 0

  const drop = async () => {
    if (running) return
    setRunning(true)
    const err = await runDdl(plan.statement, fn.keyspace)
    if (err) {
      setRunning(false)
      setError(err)
    } else onDropped()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Drop function"
      subtitle={`${fn.keyspace}.${fn.signature}`}
      width="min(520px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="border-line" disabled={!plan.statement || blocked || pending || typed !== fn.name || running} onClick={() => void drop()}>
            Drop function
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        {!blocked && (
          <>
            <p className="mt-0 text-[13px]">Dropping a function cannot be undone. Type the name of the function to confirm.</p>
            <Field label={`Type "${fn.name}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
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
