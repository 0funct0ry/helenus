import { useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Toggle } from '../ui/Toggle'
import { TypePlanPreview } from './TypePlanPreview'
import { useRolePlan } from '../api/useRolePlan'
import { useApplyRole } from '../api/useRoles'
import { useWorkspace } from '../store/workspace'
import { useToasts } from '../store/toast'
import type { RoleInfo } from '../api/types'

export interface EditRoleDialogProps {
  role: RoleInfo
  /** Called after the role was altered. */
  onSaved: () => void
  onClose: () => void
}

/**
 * Dialog for changing a role's login and superuser flags, with an optional password reset (blank keeps the current
 * password). The name is locked. Previews mask the password and the change posts to /roles/apply. Mount only while open.
 */
export function EditRoleDialog({ role, onSaved, onClose }: EditRoleDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const apply = useApplyRole(profileId)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [login, setLogin] = useState(role.login)
  const [superuser, setSuperuser] = useState(role.superuser)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const request = { action: 'alter' as const, role: role.name, ...(password ? { password } : {}), login, superuser }
  const { plan, pending } = useRolePlan(profileId, request)
  const mismatch = password !== confirm

  const save = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    const err = await apply(request)
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
      return
    }
    useToasts.getState().push(`Role ${role.name} changed`)
    onSaved()
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit role"
      subtitle={role.name}
      width="min(560px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!plan.statement || pending || running || mismatch} onClick={() => void save()}>
            Save role
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <Field label="New password (optional)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && (
          <p role="alert" className="mt-0 text-[12.5px] text-danger">
            Passwords do not match
          </p>
        )}
        <div className="mb-3 flex gap-4">
          <Toggle checked={login} onChange={setLogin}>
            Can log in
          </Toggle>
          <Toggle checked={superuser} onChange={setSuperuser}>
            Superuser
          </Toggle>
        </div>
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
