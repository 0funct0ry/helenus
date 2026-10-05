import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { RoleList } from './RoleList'
import { RoleDetail } from './RoleDetail'
import { NewRoleDialog } from './NewRoleDialog'
import { EditRoleDialog } from './EditRoleDialog'
import { DropRoleDialog } from './DropRoleDialog'
import { useRoles } from '../api/useRoles'
import { useWorkspace } from '../store/workspace'
import { describeError } from '../api/client'

/**
 * The Security tab: role list on the left, selected role's membership and permission matrix on the right, with New,
 * Edit and Drop role actions. When the cluster has no authentication the tab explains that roles have no effect and
 * disables every action.
 */
export function SecurityView() {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data, error, isLoading } = useRoles(profileId, connected)
  const [selected, setSelected] = useState('')
  const [dialog, setDialog] = useState<'new' | 'edit' | 'drop' | null>(null)

  if (!connected) return <div className="grid flex-1 place-items-center text-muted">Connect to a profile to manage roles.</div>
  if (isLoading) return <div className="p-4 text-muted">Loading roles…</div>
  if (error || !data)
    return (
      <p role="alert" className="m-4 text-danger">
        {error ? describeError(error) : 'Could not load roles'}
      </p>
    )
  const off = !data.auth_enabled
  const role = data.roles.find((r) => r.name === selected) ?? data.roles[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {off && (
        <p role="status" className="m-0 border-b border-line bg-elevated px-4 py-2 text-[12.5px]">
          Authentication is disabled on this cluster (AllowAllAuthenticator); roles have no effect.
        </p>
      )}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="m-0 text-[13px] font-semibold">Roles</h2>
        <div className="flex-1" />
        <Button icon={<Plus size={12} />} disabled={off} onClick={() => setDialog('new')}>
          New role…
        </Button>
        <Button disabled={off || !role} onClick={() => setDialog('edit')}>
          Edit role…
        </Button>
        <Button variant="danger" disabled={off || !role} onClick={() => setDialog('drop')}>
          Drop role…
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
        <div className="overflow-auto border-r border-line">
          <RoleList roles={data.roles} selected={role?.name ?? ''} onSelect={setSelected} />
        </div>
        {role ? <RoleDetail key={role.name} role={role} data={data} disabled={off} /> : <div className="grid place-items-center text-muted">No roles</div>}
      </div>
      {dialog === 'new' && <NewRoleDialog onCreated={setSelected} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && role && <EditRoleDialog role={role} onSaved={() => undefined} onClose={() => setDialog(null)} />}
      {dialog === 'drop' && role && (
        <DropRoleDialog
          role={role.name}
          onDropped={() => {
            setSelected('')
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
