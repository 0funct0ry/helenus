import { useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { TypePlanPreview } from './TypePlanPreview'
import { useKeyspaceDetail } from '../api/hooks'
import { useKeyspacePlan } from '../api/useKeyspacePlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'

export interface DropKeyspaceDialogProps {
  keyspace: string
  /** Called after the keyspace was dropped. */
  onDropped: (name: string) => void
  onClose: () => void
}

/**
 * Drop confirmation for a keyspace. It lists how many tables, views, types, functions, aggregates and
 * indexes will be lost, and enables "Drop keyspace" only once the exact (case-sensitive) name is typed.
 * The DROP KEYSPACE statement comes from the server and runs through /query. Mount it only while open.
 */
export function DropKeyspaceDialog({ keyspace, onDropped, onClose }: DropKeyspaceDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const { data: ks } = useKeyspaceDetail(profileId, keyspace)
  const runDdl = useRunDdl(profileId)
  const { plan, pending } = useKeyspacePlan(profileId, {
    action: 'drop',
    name: keyspace,
    strategy: 'SimpleStrategy',
    replication_factor: 1,
    datacenters: [],
    durable_writes: true,
    if_not_exists: false,
  })
  const [typed, setTyped] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const counts: [string, number][] = [
    ['Tables', ks?.tables.length ?? 0],
    ['Views', ks?.views.length ?? 0],
    ['Types', ks?.types.length ?? 0],
    ['Functions', ks?.functions.length ?? 0],
    ['Aggregates', ks?.aggregates.length ?? 0],
    ['Indexes', (ks?.tables ?? []).reduce((n, t) => n + t.indexes.length, 0)],
  ]

  const drop = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    const err = await runDdl(plan.statement, '')
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
    } else {
      onDropped(keyspace)
      onClose()
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Drop keyspace"
      subtitle={keyspace}
      width="min(520px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="border-line" disabled={!plan.statement || typed !== keyspace || running} onClick={() => void drop()}>
            Drop keyspace
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <p className="mt-0 text-[13px]">Dropping a keyspace deletes everything in it and cannot be undone. This will remove:</p>
        <ul aria-label="Keyspace contents" className="m-0 mb-3 grid list-none grid-cols-3 gap-1 p-0 font-mono text-[12.5px]">
          {counts.map(([label, n]) => (
            <li key={label}>
              {label}: {n}
            </li>
          ))}
        </ul>
        <Field label={`Type "${keyspace}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
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
