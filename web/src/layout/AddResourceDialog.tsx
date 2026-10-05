import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Select } from '../ui/Select'
import { useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import { resourceLabel } from '../lib/roles'
import type { RoleResource } from '../api/types'

export interface AddResourceDialogProps {
  /** Resource kinds the server offers, in display order. */
  kinds: string[]
  /** Called with the chosen resource. */
  onAdd: (resource: RoleResource) => void
  onClose: () => void
}

const NEEDS_KEYSPACE = new Set(['keyspace', 'table', 'all_functions_in_keyspace', 'function'])
const NEEDS_NAME = new Set(['table', 'role', 'function', 'mbean'])

/**
 * Dialog for adding a resource row to the permission matrix: pick a kind, then a keyspace and/or name as that kind
 * requires. Functions take their argument types as a comma-separated list. Mount only while open.
 */
export function AddResourceDialog({ kinds, onAdd, onClose }: AddResourceDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces = [] } = useSchema(profileId, connected)
  const [kind, setKind] = useState(kinds[0] ?? 'keyspace')
  const [keyspace, setKeyspace] = useState('')
  const [name, setName] = useState('')
  const [sig, setSig] = useState('')
  const resource: RoleResource = {
    kind,
    ...(NEEDS_KEYSPACE.has(kind) ? { keyspace } : {}),
    ...(NEEDS_NAME.has(kind) ? { name } : {}),
    ...(kind === 'function' ? { signature: sig.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
  }
  const valid = (!NEEDS_KEYSPACE.has(kind) || keyspace !== '') && (!NEEDS_NAME.has(kind) || name !== '')

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add resource"
      width="min(480px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              onAdd(resource)
              onClose()
            }}
          >
            Add resource
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <div className="mb-3 flex flex-col gap-[5px]">
          <span className="text-xs text-muted">Resource type</span>
          <Select aboveDialog aria-label="Resource type" value={kind} options={kinds.map((k) => ({ value: k, label: resourceLabel({ kind: k, keyspace: '<keyspace>', name: '<name>' }) }))} onChange={setKind} />
        </div>
        {NEEDS_KEYSPACE.has(kind) && (
          <div className="mb-3 flex flex-col gap-[5px]">
            <span className="text-xs text-muted">Keyspace</span>
            <Select aboveDialog aria-label="Keyspace" mono value={keyspace} options={[{ value: '', label: 'Choose…' }, ...keyspaces.map((k) => ({ value: k.name, label: k.name }))]} onChange={setKeyspace} />
          </div>
        )}
        {NEEDS_NAME.has(kind) && <Field label={kind === 'mbean' ? 'MBean name' : 'Name'} mono value={name} onChange={(e) => setName(e.target.value)} />}
        {kind === 'function' && <Field label="Argument types" mono placeholder="int, text" value={sig} onChange={(e) => setSig(e.target.value)} />}
      </div>
    </Dialog>
  )
}
