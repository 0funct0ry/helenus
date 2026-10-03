import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'
import { TypePicker } from './TypePicker'
import { TypePlanPreview } from './TypePlanPreview'
import { useSchema } from '../api/hooks'
import { useRunDdl } from '../api/useRunDdl'
import { useTypePlan } from '../api/useTypePlan'
import { useWorkspace } from '../store/workspace'
import { newDraft, toTypeDesc } from '../lib/typeBuilder'
import type { TypeDraft } from '../lib/typeBuilder'

export interface NewTypeDialogProps {
  /** Keyspace the type is created in. */
  keyspace: string
  onClose: () => void
}

interface FieldDraft {
  id: number
  name: string
  type: TypeDraft
}

let nextId = 1
const blank = (): FieldDraft => ({ id: nextId++, name: '', type: newDraft('text') })

/**
 * "New type" dialog: a type name, a list of fields (name plus a nested type picker) and a live preview of
 * the CREATE TYPE statement built by the server. Create runs the statement through /query, then opens the
 * new type's tab. Mount it only while open so each use starts from a clean form.
 */
export function NewTypeDialog({ keyspace, onClose }: NewTypeDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const open = useWorkspace((s) => s.open)
  const { data: keyspaces } = useSchema(profileId, true)
  const udts = keyspaces?.find((k) => k.name === keyspace)?.types.map((t) => t.name) ?? []
  const runDdl = useRunDdl(profileId)
  const [name, setName] = useState('')
  const [fields, setFields] = useState<FieldDraft[]>(() => [blank()])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = { action: 'create' as const, keyspace, name, fields: fields.map((f) => ({ name: f.name, type: toTypeDesc(f.type, keyspace) })) }
  const { plan, pending } = useTypePlan(profileId, request)
  const setField = (id: number, patch: Partial<FieldDraft>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const submit = async () => {
    setRunning(true)
    const err = await runDdl(plan.statement, keyspace)
    setRunning(false)
    if (err) setError(err)
    else {
      open('type', keyspace, name)
      onClose()
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New type"
      subtitle={keyspace}
      width="min(880px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!plan.statement || pending || running} onClick={() => void submit()}>
            Create type
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-5 py-3">
        <Field label="Type name" mono value={name} placeholder="geo_point" autoFocus onChange={(e) => setName(e.target.value)} />
        <h3 className="mb-2 mt-1 text-[13px] font-semibold">Fields</h3>
        <ul className="m-0 mb-2 flex list-none flex-col gap-2 p-0">
          {fields.map((f, i) => (
            <li key={f.id} className="flex items-start gap-2">
              <div className="w-56 shrink-0">
                <Input mono aria-label={`Field ${i + 1} name`} placeholder="field name" value={f.name} onChange={(e) => setField(f.id, { name: e.target.value })} />
              </div>
              <div className="min-w-0 flex-1">
                <TypePicker value={f.type} onChange={(type) => setField(f.id, { type })} udts={udts} label={`Field ${i + 1} type`} />
              </div>
              <IconButton label={`Remove field ${i + 1}`} icon={<X size={13} />} disabled={fields.length === 1} onClick={() => setFields((fs) => fs.filter((x) => x.id !== f.id))} />
            </li>
          ))}
        </ul>
        <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setFields((fs) => [...fs, blank()])}>
          Add field
        </Button>
        <h3 className="mb-2 mt-4 text-[13px] font-semibold">DDL</h3>
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
