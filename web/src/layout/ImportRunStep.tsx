import { Button } from '../ui/Button'
import { formatEta } from '../lib/importModel'
import type { ImportResult, JobInfo } from '../api/types'

export interface ImportRunStepProps {
  job: JobInfo | undefined
  starting: boolean
  startError: string | null
  canStart: boolean
  /** URL of the error report; offered once the job ended with rejected rows. */
  errorsUrl: string | null
  onStart: () => void
  onCancel: () => void
  onOpenTable: () => void
}

/**
 * Step 6 of the import wizard: Start, then a progress bar with rate, ETA and rejected count, the first rejected rows,
 * Cancel while running, and once finished "Open table" and, if rows were rejected, "Download error report".
 */
export function ImportRunStep({ job, starting, startError, canStart, errorsUrl, onStart, onCancel, onOpenTable }: ImportRunStepProps) {
  if (!job) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="m-0">The import runs in the background and can be cancelled. Rows written before a cancel stay in the table.</p>
        {startError && (
          <p role="alert" className="m-0 text-danger">
            {startError}
          </p>
        )}
        <Button variant="primary" disabled={!canStart || starting} onClick={onStart}>
          Start import
        </Button>
      </div>
    )
  }
  const p = job.progress
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
  const result = job.result && 'written' in job.result ? (job.result as ImportResult) : undefined
  const failure = job.result && 'error' in job.result ? job.result.error : undefined
  const ended = job.state !== 'running'
  const label = { running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' }[job.state]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <strong>{label}</strong>
        <span className="text-muted">
          {(result?.written ?? p.done).toLocaleString()} rows written{p.total ? ` of about ${p.total.toLocaleString()}` : ''}
        </span>
        <div className="flex-1" />
        {!ended && <Button onClick={onCancel}>Cancel</Button>}
        {ended && (result?.written ?? 0) > 0 && (
          <Button variant="primary" onClick={onOpenTable}>
            Open table
          </Button>
        )}
      </div>
      <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded bg-selected">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-muted">
        <span>{Math.round(p.rate_per_s).toLocaleString()} rows/s</span>
        {!ended && <span>ETA {formatEta(p.eta_s)}</span>}
        <span className={p.errors ? 'text-danger' : ''}>{p.errors.toLocaleString()} rejected</span>
      </div>
      {failure && (
        <p role="alert" className="m-0 text-danger">
          {failure}
        </p>
      )}
      {ended && !!result?.rejected && errorsUrl && (
        <a href={errorsUrl} download className="w-fit text-accent underline">
          Download error report
        </a>
      )}
      {!!result?.first_errors?.length && (
        <div>
          <h3 className="mb-1 mt-0 text-[13px] font-semibold">First rejected rows</h3>
          <ul className="m-0 max-h-40 list-none overflow-auto p-0 font-mono text-xs text-danger">
            {result.first_errors.map((e, i) => (
              <li key={i}>
                line {e.line}
                {e.column ? ` ${e.column}` : ''}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
