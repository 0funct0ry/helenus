import { Dialog } from '../ui/Dialog'
import { useAdvise } from '../api/useAdvise'
import { AdviceList } from './AdviceList'

export interface ReviewDataModelDialogProps {
  profile: string
  /** Keyspace to review; the dialog is closed when null. */
  keyspace: string | null
  onClose: () => void
}

/** Lists data-model findings across every table of a keyspace (the "Review data model" command). */
export function ReviewDataModelDialog({ profile, keyspace, onClose }: ReviewDataModelDialogProps) {
  const { data, isLoading, error } = useAdvise(profile, keyspace ?? '', undefined, keyspace !== null)
  return (
    <Dialog open={keyspace !== null} onClose={onClose} title="Review data model" subtitle={keyspace ?? undefined} width="min(640px, 94vw)">
      {isLoading && <p className="m-0 text-xs text-muted">Reviewing…</p>}
      {error && <p role="alert" className="m-0 text-xs text-danger">{error instanceof Error ? error.message : String(error)}</p>}
      {data && <AdviceList profile={profile} findings={data} showTable />}
    </Dialog>
  )
}
