import { useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { KeyspaceForm } from './KeyspaceForm'
import type { KeyspaceFormValue } from './KeyspaceForm'
import { TypePlanPreview } from './TypePlanPreview'
import { useKeyspaceDetail } from '../api/hooks'
import { useKeyspacePlan } from '../api/useKeyspacePlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'
import type { KeyspaceRequest } from '../api/types'

export interface EditKeyspaceDialogProps {
  keyspace: string
  /** Called after the ALTER ran; the dialog then closes itself via `onClose`. */
  onChanged: (name: string) => void
  onClose: () => void
}

const NOTHING = 'Nothing to change'

/**
 * "Edit keyspace" dialog: the new-keyspace form prefilled from the schema snapshot with the name read-only.
 * The server previews an ALTER KEYSPACE containing only the changed clauses, plus repair/cleanup notes;
 * Apply changes stays disabled until something differs. The previewed statement runs through /query.
 * Mount it only while open.
 */
export function EditKeyspaceDialog({ keyspace, onChanged, onClose }: EditKeyspaceDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const { data: ks } = useKeyspaceDetail(profileId, keyspace)
  const runDdl = useRunDdl(profileId)
  const [edit, setEdit] = useState<Partial<KeyspaceFormValue>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const repl = ks?.replication ?? {}
  const isSimple = (repl.class ?? '').endsWith('SimpleStrategy')
  const initial: KeyspaceFormValue = {
    name: keyspace,
    strategy: isSimple ? 'SimpleStrategy' : 'NetworkTopologyStrategy',
    rf: isSimple ? Number(repl.replication_factor ?? 1) : 1,
    rows: Object.entries(repl)
      .filter(([k]) => k !== 'class' && k !== 'replication_factor')
      .map(([name, rf]) => ({ name, rf: Number(rf) })),
    durable: ks?.durable_writes ?? true,
  }
  const value = { ...initial, ...edit, name: keyspace }

  const request: KeyspaceRequest = {
    action: 'alter',
    name: keyspace,
    strategy: value.strategy,
    replication_factor: value.rf,
    datacenters: value.strategy === 'NetworkTopologyStrategy' ? value.rows : [],
    durable_writes: value.durable,
    if_not_exists: false,
  }
  const { plan, pending } = useKeyspacePlan(profileId, request)
  const unchanged = plan.errors.some((e) => e.message === NOTHING)
  const shown = { ...plan, errors: plan.errors.filter((e) => e.message !== NOTHING) }
  const errs: Record<string, string> = {}
  for (const e of shown.errors) errs[e.field] ??= e.message
  const valid = !!ks && !!plan.statement && plan.errors.length === 0

  const submit = async () => {
    if (!valid || pending || inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    const err = await runDdl(plan.statement, '')
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
    } else {
      onChanged(keyspace)
      onClose()
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit keyspace"
      subtitle={keyspace}
      width="min(560px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || pending || running} onClick={() => void submit()}>
            Apply changes
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-5 py-3">
        <KeyspaceForm value={value} onChange={(p) => setEdit((e) => ({ ...e, ...p }))} errors={errs} nameReadOnly />
        <h3 className="mb-2 mt-4 text-[13px] font-semibold">CQL</h3>
        {unchanged && !pending ? <p className="m-0 text-xs text-muted">{NOTHING}</p> : <TypePlanPreview plan={shown} pending={pending} />}
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
