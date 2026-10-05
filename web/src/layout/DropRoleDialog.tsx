import { useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { TypePlanPreview } from './TypePlanPreview'
import { useRolePlan } from '../api/useRolePlan'
import { useApplyRole } from '../api/useRoles'
import { useWorkspace } from '../store/workspace'
import { useToasts } from '../store/toast'

export interface DropRoleDialogProps {
  role: string
  /** Called after the role was dropped. */
  onDropped: () => void
  onClose: () => void
}

/**
 * Drop confirmation for a role: the user types the role's name. The server plan blocks dropping the role the profile
 * is signed in as, and that reason is shown in place of the statement. Mount only while open.
 */
export function DropRoleDialog({ role, onDropped, onClose }: DropRoleDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const apply = useApplyRole(profileId)
  const request = { action: 'drop' as const, role }
  const { plan, pending } = useRolePlan(profileId, request)
  const [typed, setTyped] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const drop = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    const err = await apply(request)
    setRunning(false)
    if (err) {
      inFlight.current = false
      setError(err)
      return
    }
    useToasts.getState().push(`Role ${role} dropped`)
    onDropped()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Drop role"
      subtitle={role}
      width="min(520px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="border-line" disabled={!plan.statement || typed !== role || running} onClick={() => void drop()}>
            Drop role
          </Button>
        </>
      }
    >
      <div className="px-5 py-3">
        <p className="mt-0 text-[13px]">Dropping a role removes its permissions and cannot be undone. Type the name of the role to confirm.</p>
        <Field label={`Type "${role}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
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
