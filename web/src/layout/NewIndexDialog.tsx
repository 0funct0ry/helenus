import { useMemo, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { SegmentedControl } from '../ui/SegmentedControl'
import { TypeBadge } from '../ui/TypeBadge'
import { TypePlanPreview } from './TypePlanPreview'
import { useIndexPlan } from '../api/useIndexPlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'
import type { IndexKind, IndexTarget } from '../api/types'
import type { Column, Table } from '../lib/schemaModel'

export interface NewIndexDialogProps {
  table: Table
  /** Major version of the connected server; SAI needs 5. */
  serverMajor: number
  /** Called after the index was created. */
  onCreated: () => void
  onClose: () => void
}

const SAI_NEEDS_5 = 'SAI needs Cassandra 5.0 or later'
const SIMILARITY = ['cosine', 'dot_product', 'euclidean']

/** Valid targets of a column, default first. Mirrors the server planner, which stays the authority. */
function targetsFor(c: Column): IndexTarget[] {
  const d = c.desc
  const frozen = !!d?.frozen
  switch (d?.name) {
    case 'list':
    case 'set':
      return frozen ? ['FULL'] : ['VALUES']
    case 'map':
      return frozen ? ['FULL'] : ['VALUES', 'KEYS', 'ENTRIES']
    case 'tuple':
      return ['FULL']
    default:
      return d?.udt ? ['FULL'] : ['plain']
  }
}

const TARGET_LABEL: Record<IndexTarget, string> = { plain: 'Column', VALUES: 'Values', KEYS: 'Keys', ENTRIES: 'Entries', FULL: 'Full' }

/**
 * Dialog for creating an index. Only indexable columns can be chosen (others are dimmed with the reason on
 * hover); the target control offers just the targets valid for the column's type, and the kind control
 * switches between a legacy (2i) and an SAI index (SAI is disabled before Cassandra 5.0, and required for
 * vector columns). The CQL preview is planned by the server and run through /query on "Create index".
 */
export function NewIndexDialog({ table, serverMajor, onCreated, onClose }: NewIndexDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const saiOk = serverMajor >= 5
  const [column, setColumn] = useState('')
  const [targetPick, setTargetPick] = useState<IndexTarget | null>(null)
  const [kindPick, setKindPick] = useState<IndexKind | null>(null)
  const [name, setName] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(true)
  const [normalize, setNormalize] = useState(false)
  const [ascii, setAscii] = useState(false)
  const [similarity, setSimilarity] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const partitionCount = table.columns.filter((c) => c.kind === 'partition').length
  const col = table.columns.find((c) => c.name === column)
  const isVector = col?.desc?.name === 'vector'
  const isText = ['text', 'varchar', 'ascii'].includes(col?.desc?.name ?? '')
  const kind: IndexKind = isVector ? 'sai' : (kindPick ?? 'legacy')
  const targets = col ? targetsFor(col) : []
  const target = col ? (targetPick && targets.includes(targetPick) ? targetPick : targets[0]) : undefined

  const reason = (c: Column): string | undefined => {
    if (c.desc?.name === 'counter') return 'Counter columns cannot be indexed'
    if (kind === 'legacy' && c.kind === 'partition' && partitionCount === 1) return 'The only partition key column cannot have a legacy index'
    return undefined
  }
  const options = useMemo(
    () => ({
      ...(kind === 'sai' && isText ? { case_sensitive: caseSensitive, normalize, ascii } : {}),
      ...(kind === 'sai' && isVector && similarity ? { similarity_function: similarity } : {}),
    }),
    [kind, isText, isVector, caseSensitive, normalize, ascii, similarity],
  )
  const request = {
    action: 'create' as const,
    keyspace: table.keyspace,
    table: table.name,
    column,
    target,
    kind,
    name: name || undefined,
    options,
  }
  const { plan, pending } = useIndexPlan(profileId, request, !!column)

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

  const columnOptions = table.columns.map((c) => ({ value: c.name, label: `${c.name} · ${c.type}`, disabled: !!reason(c), title: reason(c) }))
  const label = 'text-xs text-muted'
  return (
    <Dialog
      open
      onClose={onClose}
      title="New index"
      subtitle={`${table.keyspace}.${table.name}`}
      width="min(580px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!column || !plan.statement || pending || running} onClick={() => void apply()}>
            Create index
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <div className="mb-3 flex flex-col gap-[5px]">
          <span className={label}>Column</span>
          <Select aria-label="Column" mono aboveDialog value={column} options={columnOptions} onChange={(v) => { setColumn(v); setTargetPick(null) }} />
          {col && <TypeBadge type={col.type} />}
        </div>
        <div className="mb-3 flex flex-col gap-[5px]">
          <span className={label}>Kind</span>
          <SegmentedControl<IndexKind>
            label="Index kind"
            value={kind}
            onChange={setKindPick}
            options={[
              { value: 'legacy', label: 'Secondary (2i)', disabled: isVector, title: isVector ? 'Vector columns need an SAI index' : undefined },
              { value: 'sai', label: 'SAI', disabled: !saiOk, title: saiOk ? undefined : SAI_NEEDS_5 },
            ]}
          />
          {!saiOk && <span className="text-[12px] text-muted">{SAI_NEEDS_5}</span>}
        </div>
        {col && targets.length > 1 && (
          <div className="mb-3 flex flex-col gap-[5px]">
            <span className={label}>Target</span>
            <SegmentedControl<IndexTarget> label="Index target" value={target ?? targets[0]} onChange={setTargetPick} options={targets.map((t) => ({ value: t, label: TARGET_LABEL[t] }))} />
          </div>
        )}
        {kind === 'sai' && isText && (
          <fieldset className="mb-3 flex gap-4 border-0 p-0 text-[12.5px]">
            <legend className={`${label} mb-1 p-0`}>Options</legend>
            <label><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Case sensitive</label>
            <label><input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /> Normalize</label>
            <label><input type="checkbox" checked={ascii} onChange={(e) => setAscii(e.target.checked)} /> ASCII fold</label>
          </fieldset>
        )}
        {kind === 'sai' && isVector && (
          <div className="mb-3 flex flex-col gap-[5px]">
            <span className={label}>Similarity function</span>
            <Select aria-label="Similarity function" aboveDialog value={similarity} options={[{ value: '', label: 'Default' }, ...SIMILARITY.map((v) => ({ value: v, label: v }))]} onChange={setSimilarity} />
          </div>
        )}
        <Field label="Name" mono placeholder={column ? `${table.name}_${column}_idx` : ''} value={name} onChange={(e) => setName(e.target.value)} />
        {column ? <TypePlanPreview plan={plan} pending={pending} /> : <p className="m-0 text-[12.5px] text-muted">Choose a column to see the CQL.</p>}
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
