import { useMemo, useState } from 'react'
import { Clock, ListTree } from 'lucide-react'
import { Tabs } from '../ui/Tabs'
import { ResultsGrid } from './ResultsGrid'
import { MessagesView } from './MessagesView'
import { FilteringError } from './FilteringError'
import { TraceTab } from './TraceTab'
import { CountRowsDialog } from './CountRowsDialog'
import { rowToJson, toGridColumns, toGridRows } from '../lib/rows'
import { isSelect } from '../lib/statements'
import type { Message } from '../mocks/types'
import type { StatementResult } from '../store/workspace'
import type { TraceState } from './TraceTab'

export interface ResultsPanelProps {
  results: StatementResult[]
  /** Index of the shown statement result. */
  active: number
  onActive: (index: number) => void
  consistency: string
  onPage: (index: number, dir: 1 | -1) => void
  onRunWithFiltering: (index: number) => void
  /** Runs SELECT COUNT(*) for a result and resolves to the count text. */
  onCount: (index: number) => Promise<string>
  /** Trace of the active statement; omitted when nothing was traced. */
  trace?: TraceState
}

function messagesFor(r: StatementResult | undefined, consistency: string): Message[] {
  if (!r) return []
  const out: Message[] = []
  if (r.response) {
    out.push({ id: 'ran', level: 'info', text: `Executed at ${consistency}${r.response.trace_id ? ' with tracing on' : ''} in ${r.response.timing.client_ms} ms`, detail: r.response.executed_cql })
    r.response.warnings.forEach((w, i) => out.push({ id: `w${i}`, level: 'warning', text: w }))
  }
  if (r.error) out.push({ id: 'err', level: 'error', text: r.error.message, detail: typeof r.error.detail?.executed_cql === 'string' ? r.error.detail.executed_cql : r.cql })
  return out
}

/**
 * Bottom panel of a Query tab: Results, Trace and Messages views, one statement tab per executed
 * statement, and the client timing. Results render in the virtualized grid with page-state paging;
 * a filtering error shows a one-shot "Run with ALLOW FILTERING" action. The Trace tab shows the trace
 * viewer for the active statement, a loading note while Cassandra writes the trace, or a retry state when
 * it is not yet available. The footer adds the coordinator time once the trace is loaded.
 */
export function ResultsPanel({ results, active, onActive, consistency, onPage, onRunWithFiltering, onCount, trace }: ResultsPanelProps) {
  const [view, setView] = useState('results')
  const [counting, setCounting] = useState(false)
  const r = results[active]
  const res = r?.response
  const msgs = useMemo(() => messagesFor(r, consistency), [r, consistency])
  const flagged = msgs.filter((m) => m.level !== 'info').length
  const columns = useMemo(() => (res ? toGridColumns(res.columns) : []), [res])
  const rows = useMemo(() => (res ? toGridRows(res) : []), [res])

  let body
  if (!r) body = <p className="p-4 text-muted">Run a statement to see its results here.</p>
  else if (r.status === 'running' && !res) body = <p className="p-4 text-muted">Running…</p>
  else if (r.status === 'error' && r.error?.code === 'filtering_required') body = <FilteringError message={r.error.message} onRun={() => onRunWithFiltering(active)} />
  else if (r.status === 'error') body = <p role="alert" className="m-3 rounded-md bg-err-bg px-3 py-2 text-[12.5px] text-danger">{r.error?.code === 'cancelled' ? 'Cancelled.' : r.error?.message}</p>
  else if (res?.kind === 'void') body = <p className="p-4 text-muted">Statement executed. No rows returned.</p>
  else if (res?.kind === 'schema_change') body = <p className="p-4 text-muted">Schema change applied. The schema tree was refreshed.</p>
  else if (res) {
    body = (
      <ResultsGrid
        columns={columns}
        rows={rows}
        page={r.pageStates.length}
        elapsedMs={res.timing.client_ms}
        consistency={consistency}
        hasPrev={r.pageStates.length > 1}
        hasNext={res.has_more}
        onPrev={() => onPage(active, -1)}
        onNext={() => onPage(active, 1)}
        showCount={isSelect(r.cql)}
        onCount={() => setCounting(true)}
        rowJson={(i) => rowToJson(res, i)}
      />
    )
  }

  return (
    <section aria-label="Query output" className="flex min-h-0 flex-1 flex-col bg-editor">
      <div className="flex h-[30px] flex-none items-center gap-0.5 border-b border-line2 bg-surface px-2">
        <Tabs
          aria-label="Output"
          value={view}
          onChange={setView}
          items={[
            { id: 'results', label: 'Results' },
            { id: 'trace', label: <><ListTree size={12} aria-hidden />Trace</> },
            { id: 'messages', label: 'Messages', badge: flagged || undefined },
          ]}
        />
        {results.length > 1 && (
          <div className="ml-3 border-l border-line pl-3">
            <Tabs aria-label="Statements" value={String(active)} onChange={(v) => onActive(Number(v))} items={results.map((x, i) => ({ id: String(i), label: `Statement ${i + 1}`, badge: x.status === 'error' ? '!' : undefined }))} />
          </div>
        )}
        <div className="flex-1" />
        {res && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Clock size={12} aria-hidden />
            {res.timing.client_ms} ms client
            {trace?.data && ` · ${(trace.data.duration_us / 1000).toFixed(1)} ms coordinator`}
          </span>
        )}
      </div>
      {view === 'results' && body}
      {view === 'trace' && <TraceTab response={res} trace={trace} />}
      {view === 'messages' && <MessagesView messages={msgs} />}
      <CountRowsDialog open={counting} onClose={() => setCounting(false)} onRun={() => onCount(active)} />
    </section>
  )
}
