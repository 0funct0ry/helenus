import type { TraceEvent } from '../mocks/types'

export interface TraceViewProps {
  events: TraceEvent[]
  summary: { coordinator: string; duration: string; events: number; nodes: number }
}

/** Trace panel: summary figures, a per-node waterfall of events across the request, and an event table. */
export function TraceView({ events, summary }: TraceViewProps) {
  const total = Math.max(...events.map((e) => e.elapsedUs), 1)
  const nodes = [...new Set(events.map((e) => e.node))]
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
        {fig('Duration', summary.duration)}
        {fig('Events', summary.events)}
        {fig('Nodes', summary.nodes)}
      </div>
      <div role="img" aria-label="Trace waterfall" className="overflow-hidden rounded-md border border-line2">
        {nodes.map((n, i) => {
          const mine = events.filter((e) => e.node === n)
          const start = (Math.min(...mine.map((e) => e.elapsedUs)) / total) * 100
          const end = (Math.max(...mine.map((e) => e.elapsedUs)) / total) * 100
          return (
            <div key={n} className="grid grid-cols-[160px_1fr] border-b border-line2 last:border-b-0">
              <div className="border-r border-line2 p-2.5 font-mono text-xs">
                {n}
                <small className="block font-sans text-faint">{i === 0 ? 'coordinator' : 'replica'}</small>
              </div>
              <div className="relative h-[52px]">
                <div className="absolute top-[19px] h-3.5 rounded-[3px] bg-accent/70" style={{ left: `${start}%`, width: `${Math.max(end - start, 0.8)}%` }} />
                {mine.map((e, k) => (
                  <div key={k} className="absolute top-[21px] h-2.5 w-0.5 bg-muted" style={{ left: `${(e.elapsedUs / total) * 100}%` }} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <table className="mt-4 w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {['Elapsed', 'Node', 'Activity', 'Thread'].map((h) => (
              <th key={h} className="sticky top-0 border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className="border-b border-line2 px-2.5 py-1.5 align-top font-mono">{(e.elapsedUs / 1000).toFixed(1)} ms</td>
              <td className="border-b border-line2 px-2.5 py-1.5 align-top font-mono">{e.node}</td>
              <td className="border-b border-line2 px-2.5 py-1.5 align-top">{e.activity}</td>
              <td className="border-b border-line2 px-2.5 py-1.5 align-top font-mono text-muted">{e.thread}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
