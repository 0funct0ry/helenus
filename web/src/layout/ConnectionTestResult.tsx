import { Check, X } from 'lucide-react'
import type { TestResult } from '../api/types'

export interface ConnectionTestResultProps {
  /** Staged result from the API, or undefined while nothing was tested. */
  result?: TestResult
  /** Transport or request error, shown when there is no staged result. */
  error?: string
}

/**
 * The staged outcome of Test connection (DNS, TCP, TLS, auth, protocol): one row per stage with a
 * tick or cross, then the cluster summary on success or the driver's error text on failure.
 */
export function ConnectionTestResult({ result, error }: ConnectionTestResultProps) {
  if (error && !result) return <div role="alert" className="mt-3 text-[12.5px] text-danger">{error}</div>
  if (!result) return null
  const i = result.info
  return (
    <div role="status" aria-label="Connection test result" className="mt-3 rounded border border-line2 bg-surface p-2.5 text-[12.5px]">
      <ul className="m-0 list-none p-0">
        {result.stages.map((s) => (
          <li key={s.name} className="flex items-start gap-1.5 py-0.5">
            {s.ok ? <Check size={14} className="mt-px text-ok" aria-label="passed" /> : <X size={14} className="mt-px text-danger" aria-label="failed" />}
            <span className="w-16 shrink-0 font-medium">{s.name}</span>
            <span className={`min-w-0 break-words font-mono text-[12px] ${s.ok ? 'text-muted' : 'text-danger'}`}>{s.detail}</span>
          </li>
        ))}
      </ul>
      {result.ok && i && (
        <p className="m-0 mt-1.5 text-ok">
          Connected in {Math.round(result.rtt_ms ?? 0)} ms
          <span className="ml-1.5 text-muted">
            Cassandra {i.release_version}, {i.datacenters.length} datacenter{i.datacenters.length === 1 ? '' : 's'}, {i.node_count} node
            {i.node_count === 1 ? '' : 's'}
          </span>
        </p>
      )}
      {!result.ok && <p className="m-0 mt-1.5 text-danger">Failed at the {result.failed_stage} stage.</p>}
      {result.warnings?.map((w) => (
        <p key={w} className="m-0 mt-1 text-warn">
          {w}
        </p>
      ))}
    </div>
  )
}
