import { Info } from 'lucide-react'
import { NO_DESCRIPTION, useSystemDocs } from '../api/useSystemDocs'

export interface SystemTableBannerProps {
  keyspace: string
  table: string
}

/**
 * "What is this table?" banner at the top of a system table's tab: the catalog description of the table,
 * or "No description available" when it is not cataloged.
 */
export function SystemTableBanner({ keyspace, table }: SystemTableBannerProps) {
  const { data } = useSystemDocs()
  const desc = data?.keyspaces[keyspace]?.tables[table]?.description ?? NO_DESCRIPTION
  return (
    <div role="note" className="flex flex-none items-start gap-2 border-b border-line2 bg-surface px-3 py-1.5 text-xs">
      <Info size={13} className="mt-px shrink-0 text-muted" aria-hidden />
      <span>
        <span className="font-medium">What is this table? </span>
        <span className="text-muted">{desc}</span>
      </span>
    </div>
  )
}
