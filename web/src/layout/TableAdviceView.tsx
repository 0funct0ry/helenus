import { useAdvise } from '../api/useAdvise'
import { AdviceList } from './AdviceList'

export interface TableAdviceViewProps {
  profile: string
  keyspace: string
  table: string
}

/** The "Advice" sub-view of the Table tab: data-model findings for one table, loaded from the advise API. */
export function TableAdviceView({ profile, keyspace, table }: TableAdviceViewProps) {
  const { data, isLoading, error } = useAdvise(profile, keyspace, table)
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {isLoading && <p className="m-0 text-xs text-muted">Reviewing…</p>}
      {error && <p role="alert" className="m-0 text-xs text-danger">{error instanceof Error ? error.message : String(error)}</p>}
      {data && <AdviceList profile={profile} findings={data} />}
    </div>
  )
}
