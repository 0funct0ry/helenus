import type { TraceLane, TraceResponse } from '../api/types'

export interface TraceViewProps {
  trace: TraceResponse
  /** Client-measured round trip in ms, shown beside the coordinator duration. */
  clientMs?: number
}

const ms = (us: number) => `${(us / 1000).toFixed(1)} ms`

/** The bar that gets a visible label: the longest span in the lane. */
function longest(l: TraceLane) {
  return l.bars.reduce((a, b) => (b.end_us - b.start_us > a.end_us - a.start_us ? b : a), l.bars[0])
}

/**
 * Trace panel: summary figures, a waterfall with one lane per node and an events table with the cqlsh columns.
 * Bars sit at their `source_elapsed` position, which each node measures on its own clock, so lanes are
 * comparable by shape rather than by absolute alignment. A bar's full activity text is its tooltip, and the
 * longest bar in each lane is labelled inline.
 */
export function TraceView({ trace, clientMs }: TraceViewProps) {
  const { summary, lanes, events } = trace
  const total = Math.max(trace.duration_us, ...events.map((e) => e.elapsed_us), 1)
  const pct = (us: number) => (us / total) * 100
  const fig = (label: string, value: string | number) => (
    <div key={label}>
      <span className="block text-xs text-muted">{label}</span>
      <b className="font-mono text-[15px] font-medium">{value}</b>
    </div>
  )
  return (
    <div className="flex-1 overflow-auto px-4 py-3.5">
      <div className="mb-3.5 flex flex-wrap gap-7">
        {fig('Coordinator', summary.coordinator)}
        {fig('Request', summary.request)}
        {fig('Coordinator duration', ms(trace.duration_us))}
        {clientMs !== undefined && fig('Client round trip', `${clientMs} ms`)}
        {fig('Replicas contacted', summary.replicas_contacted)}
      </div>
      <div role="img" aria-label="Trace waterfall" className="overflow-hidden rounded-md border border-line2">
        <div className="grid grid-cols-[160px_1fr] border-b border-line2 bg-surface text-xs text-muted">
          <div className="px-2.5 py-1">Node</div>
          <div className="flex justify-between px-2 py-1 font-mono">
            <span>0 ms</span>
            <span>{ms(total)}</span>
          </div>
        </div>
        {lanes.map((l) => {
          const top = l.bars.length ? longest(l) : undefined
          return (
            <div key={l.node} className="grid grid-cols-[160px_1fr] border-b border-line2 last:border-b-0">
              <div className="border-r border-line2 p-2.5 font-mono text-xs">
                {l.node}
                <small className="block font-sans text-faint">{l.role === 'coordinator' ? 'Coordinator' : 'Replica'}</small>
              </div>
              <div className="relative h-[52px]">
                {l.bars.map((b, i) => (
                  <div
                    key={i}
                    title={b.label}
                    className="absolute top-[10px] h-3.5 rounded-[3px] bg-accent/70"
                    style={{ left: `${pct(b.start_us)}%`, width: `${Math.max(pct(b.end_us - b.start_us), 0.6)}%` }}
                  />
                ))}
                {top && (
                  <span className="absolute top-[29px] max-w-[60%] truncate text-[11px] text-muted" style={{ left: `${pct(top.start_us)}%` }}>
                    {top.label}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <table aria-label="Trace events" className="mt-4 w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {['Activity', 'Source', 'Elapsed (µs)', 'Thread'].map((h, i) => (
              <th key={h} className={`sticky top-0 border-b border-line bg-surface px-2.5 py-1.5 font-medium text-muted ${i === 2 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className="border-b border-line2 px-2.5 py-1.5 align-top">{e.activity}</td>
              <td className="border-b border-line2 px-2.5 py-1.5 align-top font-mono">{e.source}</td>
              <td className="border-b border-line2 px-2.5 py-1.5 text-right align-top font-mono">{e.elapsed_us.toLocaleString('en-US')}</td>
              <td className="border-b border-line2 px-2.5 py-1.5 align-top font-mono text-muted">{e.thread}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
