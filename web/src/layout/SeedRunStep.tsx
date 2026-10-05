import { Button } from '../ui/Button'
import type { JobInfo, SeedResult } from '../api/types'

export interface SeedRunStepProps {
  job: JobInfo | undefined
  starting: boolean
  startError: string | null
  /** Rows the run will write, shown before it starts. */
  totalRows: number
  canStart: boolean
  onStart: () => void
  onCancel: () => void
  onOpenTable: () => void
}

function eta(s: number): string {
  if (!s || !Number.isFinite(s)) return '–'
  return s < 60 ? `${Math.ceil(s)} s` : `${Math.floor(s / 60)} min ${Math.ceil(s % 60)} s`
}

/**
 * Step 4 of the seed wizard: Start, then a progress bar with rate, ETA and error count, the first 100 error messages,
 * Cancel while running, and "Open table" once the job has ended.
 */
export function SeedRunStep({ job, starting, startError, totalRows, canStart, onStart, onCancel, onOpenTable }: SeedRunStepProps) {
  if (!job) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="m-0">This writes {totalRows.toLocaleString()} rows to the table. It runs in the background and can be cancelled.</p>
        {startError && (
          <p role="alert" className="m-0 text-danger">
            {startError}
          </p>
        )}
        <Button variant="primary" disabled={!canStart || starting} onClick={onStart}>
          Start seeding
        </Button>
      </div>
    )
  }
  const p = job.progress
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
  const result = job.result && 'written' in job.result ? (job.result as SeedResult) : undefined
  const failure = job.result && 'error' in job.result ? job.result.error : undefined
  const ended = job.state !== 'running'
  const label = { running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' }[job.state]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <strong>{label}</strong>
        <span className="text-muted">
          {(result?.written ?? p.done).toLocaleString()} of {p.total.toLocaleString()} rows
        </span>
        <div className="flex-1" />
        {!ended && <Button onClick={onCancel}>Cancel</Button>}
        {ended && (result?.written ?? 0) > 0 && (
          <Button variant="primary" onClick={onOpenTable}>
            Open table
          </Button>
        )}
      </div>
      <div role="progressbar" aria-label="Seed progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded bg-selected">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-muted">
        <span>{Math.round(p.rate_per_s).toLocaleString()} rows/s</span>
        {!ended && <span>ETA {eta(p.eta_s)}</span>}
        <span className={p.errors ? 'text-danger' : ''}>{p.errors.toLocaleString()} errors</span>
        {!!result?.skipped_duplicates && <span>{result.skipped_duplicates.toLocaleString()} duplicate keys skipped</span>}
      </div>
      {failure && (
        <p role="alert" className="m-0 text-danger">
          {failure}
        </p>
      )}
      {job.state === 'failed' && !failure && <p className="m-0 text-danger">The job failed.</p>}
      {!!result?.first_errors?.length && (
        <div>
          <h3 className="mb-1 mt-0 text-[13px] font-semibold">First errors</h3>
          <ul className="m-0 max-h-40 list-none overflow-auto p-0 font-mono text-xs text-danger">
            {result.first_errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
