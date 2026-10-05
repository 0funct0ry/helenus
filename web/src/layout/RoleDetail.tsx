import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { PermissionMatrix } from './PermissionMatrix'
import { RolePendingBar } from './RolePendingBar'
import type { PendingPermission } from './RolePendingBar'
import { AddResourceDialog } from './AddResourceDialog'
import { useApplyRole, useRolePermissions } from '../api/useRoles'
import { useWorkspace } from '../store/workspace'
import { resourceKey } from '../lib/roles'
import type { RoleInfo, RoleResource, RolesResponse } from '../api/types'

export interface RoleDetailProps {
  role: RoleInfo
  data: RolesResponse
  /** Disables every action (authentication is off). */
  disabled?: boolean
}

/**
 * Detail for one role: Members and Member of lists (with revoke buttons and a grant picker), and the permission
 * matrix with its pending bar. Toggling a cell queues a GRANT or REVOKE; nothing runs until Apply. Resource rows come
 * from the role's direct grants plus any added with "Add resource".
 */
export function RoleDetail({ role, data, disabled }: RoleDetailProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const apply = useApplyRole(profileId)
  const { data: perms } = useRolePermissions(profileId, role.name, !disabled)
  const [extra, setExtra] = useState<RoleResource[]>([])
  const [toggled, setToggled] = useState<Record<string, PendingPermission>>({})
  const [adding, setAdding] = useState(false)
  const [parent, setParent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const authzOff = !!perms && !perms.authorizer_enabled

  const { granted, resources } = useMemo(() => {
    const granted = new Set<string>()
    const rows = new Map<string, RoleResource>()
    for (const p of perms?.permissions ?? []) {
      granted.add(`${resourceKey(p.resource)}|${p.permission}`)
      rows.set(resourceKey(p.resource), p.resource)
    }
    for (const r of extra) rows.set(resourceKey(r), rows.get(resourceKey(r)) ?? r)
    return { granted, resources: [...rows.values()] }
  }, [perms, extra])

  const toggle = (resource: RoleResource, permission: string, grant: boolean) => {
    const key = `${resourceKey(resource)}|${permission}`
    setToggled((t) => {
      const next = { ...t }
      if (granted.has(key) === grant) delete next[key]
      else next[key] = { key, request: { action: grant ? 'grant' : 'revoke', role: role.name, permission, resource } }
      return next
    })
  }

  const grantRole = async (action: 'grant_role' | 'revoke_role', member_of: string) => {
    setError(null)
    const err = await apply({ action, role: role.name, member_of })
    if (err) setError(err)
    else setParent('')
  }
  const candidates = data.roles.filter((r) => r.name !== role.name && !role.member_of.includes(r.name))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto p-4">
        <section aria-label="Membership" className="mb-5 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 mt-0 text-[12px] font-medium text-muted">Member of</h3>
            <ul className="m-0 mb-2 flex list-none flex-wrap gap-1.5 p-0">
              {role.member_of.length === 0 && <li className="text-[12.5px] text-muted">None</li>}
              {role.member_of.map((p) => (
                <li key={p} className="inline-flex items-center gap-1">
                  <Badge>{p}</Badge>
                  <button type="button" aria-label={`Revoke ${p} from ${role.name}`} disabled={disabled} onClick={() => void grantRole('revoke_role', p)} className="border-0 bg-transparent p-0 text-muted hover:text-danger">
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <Select aria-label="Grant role" mono value={parent} options={[{ value: '', label: 'Grant role…' }, ...candidates.map((r) => ({ value: r.name, label: r.name }))]} onChange={setParent} />
              <Button disabled={disabled || !parent} onClick={() => void grantRole('grant_role', parent)}>
                Grant
              </Button>
            </div>
          </div>
          <div>
            <h3 className="mb-1 mt-0 text-[12px] font-medium text-muted">Members</h3>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {role.members.length === 0 && <li className="text-[12.5px] text-muted">None</li>}
              {role.members.map((m) => (
                <li key={m}>
                  <Badge>{m}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {error && (
          <p role="alert" className="mt-0 text-[12.5px] text-danger">
            {error}
          </p>
        )}
        <div className="mb-2 flex items-center">
          <h3 className="m-0 text-[12px] font-medium text-muted">Permissions</h3>
          <div className="flex-1" />
          <Button icon={<Plus size={12} />} disabled={disabled || authzOff} onClick={() => setAdding(true)}>
            Add resource
          </Button>
        </div>
        {authzOff && <p className="mt-0 text-[12.5px] text-muted">Authorization is disabled on this cluster (AllowAllAuthorizer); permissions have no effect.</p>}
        <PermissionMatrix
          resources={resources}
          applicable={data.applicable}
          granted={granted}
          pending={new Set(Object.keys(toggled))}
          disabled={disabled || authzOff}
          onToggle={toggle}
        />
      </div>
      <RolePendingBar
        items={Object.values(toggled)}
        onDiscard={() => setToggled({})}
        onApplied={(keys) =>
          setToggled((t) => {
            const next = { ...t }
            for (const k of keys) delete next[k]
            return next
          })
        }
      />
      {adding && <AddResourceDialog kinds={Object.keys(data.applicable)} onAdd={(r) => setExtra((e) => [...e, r])} onClose={() => setAdding(false)} />}
    </div>
  )
}
