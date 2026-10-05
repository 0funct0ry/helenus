import { useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { TypePlanPreview } from './TypePlanPreview'
import { useTriggerPlan } from '../api/useTriggerPlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'
import type { Table } from '../lib/schemaModel'

export interface NewTriggerDialogProps {
  table: Table
  /** Called after the trigger was created. */
  onCreated: () => void
  onClose: () => void
}

/**
 * Dialog for attaching a trigger: a name and a fully qualified Java class. The server plans the CQL preview
 * (class syntax errors and the "JAR must be on every node" note appear there) and the statement runs through
 * /query on "Create trigger"; a server failure, such as a class that is not installed, is shown inline and
 * the dialog stays open. Mount only while open.
 */
export function NewTriggerDialog({ table, onCreated, onClose }: NewTriggerDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const [name, setName] = useState('')
  const [cls, setCls] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const touched = name !== '' || cls !== ''
  const { plan, pending } = useTriggerPlan(
    profileId,
    { action: 'create', keyspace: table.keyspace, table: table.name, name, class: cls },
    touched,
  )

  const apply = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    const err = await runDdl(plan.statement, table.keyspace)
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
    } else {
      onCreated()
      onClose()
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New trigger"
      subtitle={`${table.keyspace}.${table.name}`}
      width="min(560px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!touched || !plan.statement || pending || running} onClick={() => void apply()}>
            Create trigger
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <Field label="Name" mono placeholder="audit" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Class" mono placeholder="com.example.Audit" value={cls} onChange={(e) => setCls(e.target.value)} />
        {touched ? <TypePlanPreview plan={plan} pending={pending} /> : <p className="m-0 text-[12.5px] text-muted">Enter a name and class to see the CQL.</p>}
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
