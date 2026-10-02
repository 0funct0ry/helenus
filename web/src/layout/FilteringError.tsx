import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button'

export interface FilteringErrorProps {
  /** Cassandra's explanation. */
  message: string
  /** Re-runs the statement with ALLOW FILTERING for this execution only. */
  onRun: () => void
}

/** Error panel for a query Cassandra refused because it needs filtering, with a one-shot "Run with ALLOW FILTERING" action. */
export function FilteringError({ message, onRun }: FilteringErrorProps) {
  return (
    <div role="alert" className="m-3 rounded-md bg-warn-bg px-3 py-2.5 text-[12.5px]">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div>
          <p className="m-0 font-medium">This query needs ALLOW FILTERING</p>
          <p className="mb-2 mt-1">The columns in the WHERE clause are not covered by the primary key or an index, so Cassandra would have to scan data to answer it. That can be slow on large tables.</p>
          <p className="mb-2 mt-0 font-mono text-xs text-muted">{message}</p>
          <Button variant="primary" onClick={onRun}>
            Run with ALLOW FILTERING
          </Button>
        </div>
      </div>
    </div>
  )
}
