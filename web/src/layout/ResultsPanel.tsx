import { useState } from 'react'
import { Clock, ListTree } from 'lucide-react'
import { Tabs } from '../ui/Tabs'
import { ResultsGrid } from './ResultsGrid'
import { TraceView } from './TraceView'
import { MessagesView } from './MessagesView'
import { queryColumns, queryRows } from '../mocks/rows'
import { messages, traceEvents, traceSummary } from '../mocks/trace'
import { useWorkspace } from '../store/workspace'

/**
 * Bottom panel of a Query tab: Results, Trace and Messages views, statement chips and timing.
 * Shows mock data in this milestone.
 */
export function ResultsPanel() {
  const [view, setView] = useState('results')
  const [stmt, setStmt] = useState('2')
  const consistency = useWorkspace((s) => s.consistency)
  const warnings = messages.filter((m) => m.level !== 'info').length
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
            { id: 'messages', label: 'Messages', badge: warnings },
          ]}
        />
        <div className="ml-3 border-l border-line pl-3">
          <Tabs aria-label="Statements" value={stmt} onChange={setStmt} items={[{ id: '2', label: 'Statement 2' }, { id: '1', label: 'Statement 1' }]} />
        </div>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Clock size={12} aria-hidden />
          38.2 ms client · 31.7 ms coordinator
        </span>
      </div>
      {view === 'results' && <ResultsGrid columns={queryColumns} rows={queryRows} consistency={consistency} />}
      {view === 'trace' && <TraceView events={traceEvents} summary={traceSummary} />}
      {view === 'messages' && <MessagesView messages={messages} />}
    </section>
  )
}
