import { Hourglass } from 'lucide-react'
import { Button } from '../ui/Button'

export interface TraceUnavailableProps {
  /** Re-requests the trace. */
  onRetry: () => void
  /** Set when the request failed for another reason than the trace still being written. */
  message?: string
}

/** "Trace not yet available" state of the Trace tab: Cassandra writes traces asynchronously, so a Retry button asks again. */
export function TraceUnavailable({ onRetry, message }: TraceUnavailableProps) {
  return (
    <div role="status" className="m-3 flex items-start gap-2.5 rounded-md bg-warn-bg px-3 py-2.5 text-[12.5px]">
      <Hourglass size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      <div>
        <p className="m-0 font-medium">Trace not yet available</p>
        <p className="mb-2 mt-1">{message ?? 'Cassandra writes traces asynchronously and this one was not complete after two seconds. Try again in a moment.'}</p>
        <Button variant="primary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  )
}
