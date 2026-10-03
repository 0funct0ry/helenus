import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { TypePicker } from './TypePicker'
import { TypePlanPreview } from './TypePlanPreview'
import { useSchema } from '../api/hooks'
import { useRunDdl } from '../api/useRunDdl'
import { useTypePlan } from '../api/useTypePlan'
import { useWorkspace } from '../store/workspace'
import { newDraft, toTypeDesc } from '../lib/typeBuilder'
import type { TypeRequest } from '../api/types'

export interface AlterFieldDialogProps {
  keyspace: string
  /** The type being altered. */
  type: string
  /** `add` asks for a name and a type; `rename` asks for the new name of `field`. */
  mode: 'add' | 'rename'
  /** The field being renamed (rename mode). */
  field?: string
  onClose: () => void
}

/**
 * Dialog for the two ALTER TYPE actions Cassandra supports: add a field (name plus nested type picker) and
 * rename a field. Shows the server-built statement live and runs it through /query on confirm. Changing a
 * field's type is deliberately not offered. Mount it only while open.
 */
export function AlterFieldDialog({ keyspace, type, mode, field, onClose }: AlterFieldDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const { data: keyspaces } = useSchema(profileId, true)
  const udts = (keyspaces?.find((k) => k.name === keyspace)?.types.map((t) => t.name) ?? []).filter((n) => n !== type)
  const runDdl = useRunDdl(profileId)
  const [name, setName] = useState(mode === 'rename' ? (field ?? '') : '')
  const [draft, setDraft] = useState(() => newDraft('text'))
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request: TypeRequest =
    mode === 'add'
      ? { action: 'add_field', keyspace, name: type, field: { name, type: toTypeDesc(draft, keyspace) } }
      : { action: 'rename_field', keyspace, name: type, from: field, to: name }
  const { plan, pending } = useTypePlan(profileId, request)

  const submit = async () => {
    setRunning(true)
    const err = await runDdl(plan.statement, keyspace)
    setRunning(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'add' ? 'Add field' : 'Rename field'}
      subtitle={`${keyspace}.${type}`}
      width="min(720px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!plan.statement || pending || running} onClick={() => void submit()}>
            {mode === 'add' ? 'Add field' : 'Rename field'}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-5 py-3">
        <Field label={mode === 'add' ? 'Field name' : `New name for ${field}`} mono value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        {mode === 'add' && (
          <div className="mb-3">
            <div className="mb-1.5 text-xs text-muted">Type</div>
            <TypePicker value={draft} onChange={setDraft} udts={udts} label="Field type" />
          </div>
        )}
        <h3 className="mb-2 mt-1 text-[13px] font-semibold">DDL</h3>
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
