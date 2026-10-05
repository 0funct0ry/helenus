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

export interface NewRoleDialogProps {
  /** Called after the role was created, with its name. */
  onCreated: (role: string) => void
  onClose: () => void
}

/**
 * Dialog for creating a role: name, password with confirmation (at least 8 characters), and login and superuser
 * switches. The CQL preview comes from the server with the password masked; "Create role" posts to /roles/apply, so the
 * password never reaches the query paths. Server failures show inline and the inputs are kept. Mount only while open.
 */
export function NewRoleDialog({ onCreated, onClose }: NewRoleDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const apply = useApplyRole(profileId)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [login, setLogin] = useState(true)
  const [superuser, setSuperuser] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const touched = name !== ''
  const request = { action: 'create' as const, role: name, ...(password ? { password } : {}), login, superuser }
  const { plan, pending } = useRolePlan(profileId, request, touched)
  const mismatch = password !== confirm

  const create = async () => {
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
    useToasts.getState().push(`Role ${name} created`)
    onCreated(name)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New role"
      width="min(560px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!touched || !plan.statement || pending || running || mismatch} onClick={() => void create()}>
            Create role
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <Field label="Role name" mono placeholder="analyst" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
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
        {touched ? <TypePlanPreview plan={plan} pending={pending} /> : <p className="m-0 text-[12.5px] text-muted">Enter a role name to see the CQL.</p>}
        {error && (
          <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
