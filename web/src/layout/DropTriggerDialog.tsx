import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useTriggerPlan } from '../api/useTriggerPlan'
import { useRunDdl } from '../api/useRunDdl'
import { useWorkspace } from '../store/workspace'

export interface DropTriggerDialogProps {
  keyspace: string
  table: string
  trigger: string
  /** Called after the trigger was dropped. */
  onDropped: () => void
  /** Called with the server's message when the statement fails. */
  onError: (message: string) => void
  onClose: () => void
}

/**
 * Confirmation for dropping a trigger. The planned `DROP TRIGGER` statement is shown in the message and run
 * through /query on confirm. Mount only while open.
 */
export function DropTriggerDialog({ keyspace, table, trigger, onDropped, onError, onClose }: DropTriggerDialogProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const runDdl = useRunDdl(profileId)
  const { plan } = useTriggerPlan(profileId, { action: 'drop', keyspace, table, name: trigger })
  const confirm = async () => {
    if (!plan.statement) return
    const err = await runDdl(plan.statement, keyspace)
    if (err) onError(err)
    else onDropped()
    onClose()
  }
  const message = plan.errors[0]?.message ?? `This runs ${plan.statement || '…'} Writes to the table will no longer invoke the trigger.`
  return <ConfirmDialog open title={`Drop trigger ${trigger}?`} message={message} confirmLabel="Drop trigger" danger onConfirm={() => void confirm()} onCancel={onClose} />
}
