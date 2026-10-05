import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useIndexPlan } from '../api/useIndexPlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'

export interface DropIndexDialogProps {
  keyspace: string
  index: string
  /** Called after the index was dropped. */
  onDropped: () => void
  /** Called with the server's message when the statement fails. */
  onError: (message: string) => void
  onClose: () => void
}

/**
 * Confirmation for dropping an index. Indexes have no dependents, so no typed name is needed; the planned
 * `DROP INDEX` statement is shown in the message and run through /query on confirm. Mount only while open.
 */
export function DropIndexDialog({ keyspace, index, onDropped, onError, onClose }: DropIndexDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const { plan } = useIndexPlan(profileId, { action: 'drop', keyspace, name: index })
  const confirm = async () => {
    if (!plan.statement) return
    const err = await runDdl(plan.statement, keyspace)
    if (err) onError(err)
    else onDropped()
    onClose()
  }
  const message = plan.errors[0]?.message ?? `This runs ${plan.statement || '…'} Queries that rely on the index will stop working.`
  return <ConfirmDialog open title={`Drop index ${index}?`} message={message} confirmLabel="Drop index" danger onConfirm={() => void confirm()} onCancel={onClose} />
}
