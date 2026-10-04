import { useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field } from '../ui/Field'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Toggle } from '../ui/Toggle'
import { DatacenterRows } from './DatacenterRows'
import type { DatacenterRow } from './DatacenterRows'
import { TypePlanPreview } from './TypePlanPreview'
import { useCluster } from '../api/hooks'
import { useKeyspacePlan } from '../api/useKeyspacePlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'
import type { KeyspaceRequest } from '../api/types'

export interface NewKeyspaceDialogProps {
  /** Called with the keyspace name after it was created; the dialog then closes itself via `onClose`. */
  onCreated: (name: string) => void
  onClose: () => void
}

type Strategy = KeyspaceRequest['strategy']

/**
 * "New keyspace" dialog: a name, replication strategy (SimpleStrategy with a factor, or
 * NetworkTopologyStrategy with a datacenter table prefilled from the cluster), durable writes and
 * IF NOT EXISTS, with a live preview of the CREATE KEYSPACE statement built by the server. Create runs that
 * statement through /query. Closing with a typed name asks for confirmation. Mount it only while open.
 */
export function NewKeyspaceDialog({ onCreated, onClose }: NewKeyspaceDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const { data: cluster } = useCluster(profileId, true)
  const runDdl = useRunDdl(profileId)
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState<Strategy>('SimpleStrategy')
  const [rf, setRf] = useState(1)
  const [edited, setEdited] = useState<DatacenterRow[] | null>(null)
  const [durable, setDurable] = useState(true)
  const [ifNotExists, setIfNotExists] = useState(false)
  const [blurred, setBlurred] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const inFlight = useRef(false)

  const prefill: DatacenterRow[] = (() => {
    const dcs = cluster?.datacenters ?? []
    if (dcs.length === 0) return [{ name: '', rf: 1 }]
    return dcs.map((dc) => ({ name: dc, rf: Math.min(3, cluster?.nodes.filter((n) => n.dc === dc).length || 3) }))
  })()
  const rows = edited ?? prefill

  const request: KeyspaceRequest = {
    name,
    strategy,
    replication_factor: rf,
    datacenters: strategy === 'NetworkTopologyStrategy' ? rows : [],
    durable_writes: durable,
    if_not_exists: ifNotExists,
  }
  const { plan, pending } = useKeyspacePlan(profileId, request)
  const errs: Record<string, string> = {}
  for (const e of plan.errors) errs[e.field] ??= e.message
  const showErrors = blurred || submitted
  const valid = !!plan.statement && plan.errors.length === 0

  const requestClose = () => (name.trim() !== '' ? setConfirmDiscard(true) : onClose())

  const submit = async () => {
    setSubmitted(true)
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
      onCreated(name)
      onClose()
    }
  }

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title="New keyspace"
        width="min(560px, 94vw)"
        footer={
          <>
            <div className="flex-1" />
            <Button onClick={requestClose}>Cancel</Button>
            <Button variant="primary" disabled={!valid || pending || running} onClick={() => void submit()}>
              Create keyspace
            </Button>
          </>
        }
      >
        <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-5 py-3">
          <Field
            label="Name"
            mono
            autoFocus
            value={name}
            placeholder="shop"
            aria-invalid={showErrors && !!errs.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setBlurred(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
          {showErrors && errs.name && <p className="-mt-2 mb-3 text-xs text-danger">{errs.name}</p>}
          <div className="mb-3 flex flex-col gap-[5px]">
            <span className="text-xs text-muted">Replication strategy</span>
            <SegmentedControl
              label="Replication strategy"
              value={strategy}
              onChange={setStrategy}
              options={[
                { value: 'SimpleStrategy', label: 'SimpleStrategy' },
                { value: 'NetworkTopologyStrategy', label: 'NetworkTopologyStrategy' },
              ]}
            />
          </div>
          {strategy === 'SimpleStrategy' ? (
            <>
              <Field label="Replication factor" type="number" min={1} max={20} value={Number.isNaN(rf) ? '' : rf} aria-invalid={showErrors && !!errs.replication_factor} onChange={(e) => setRf(e.target.value === '' ? NaN : Number(e.target.value))} />
              {showErrors && errs.replication_factor && <p className="-mt-2 mb-3 text-xs text-danger">{errs.replication_factor}</p>}
            </>
          ) : (
            <div className="mb-3">
              <span className="mb-[5px] block text-xs text-muted">Datacenters</span>
              <DatacenterRows rows={rows} errors={showErrors ? errs : {}} onChange={setEdited} />
            </div>
          )}
          <div className="mb-3 flex flex-col items-start gap-1">
            <Toggle checked={durable} onChange={setDurable}>
              Durable writes
            </Toggle>
            <Toggle checked={ifNotExists} onChange={setIfNotExists}>
              Create only if it doesn't exist
            </Toggle>
          </div>
          <h3 className="mb-2 mt-4 text-[13px] font-semibold">CQL</h3>
          <TypePlanPreview plan={plan} pending={pending} />
          {error && (
            <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this keyspace?"
        message="The details you entered will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}
