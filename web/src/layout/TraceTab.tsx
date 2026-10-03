import { TraceView } from './TraceView'
import { TraceUnavailable } from './TraceUnavailable'
import type { QueryResponse, TraceResponse } from '../api/types'

/** Load state of a statement's trace, owned by the caller so the tab stays free of data fetching. */
export interface TraceState {
  data?: TraceResponse
  loading: boolean
  /** Error code and message when the fetch failed; `trace_unavailable` means Cassandra has not finished writing it. */
  error?: { code: string; message: string }
  onRetry: () => void
}

export interface TraceTabProps {
  /** The statement's response; its `trace_id` says whether tracing was on. */
  response?: QueryResponse
  trace?: TraceState
}

/**
 * Body of the Trace tab. Picks between a hint (tracing was off), a waiting note while the trace loads, the
 * "Trace not yet available" retry state, and the trace viewer.
 */
export function TraceTab({ response, trace }: TraceTabProps) {
  if (!response?.trace_id) return <p className="p-4 text-muted">Turn on Trace in the toolbar and run a statement to record a trace.</p>
  if (trace?.data) return <TraceView trace={trace.data} clientMs={response.timing.client_ms} />
  if (trace?.error?.code === 'trace_unavailable') return <TraceUnavailable onRetry={trace.onRetry} />
  if (trace?.error) return <TraceUnavailable onRetry={trace.onRetry} message={trace.error.message} />
  return <p className="p-4 text-muted">Waiting for Cassandra to write the trace…</p>
}
