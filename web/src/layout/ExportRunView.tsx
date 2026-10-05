import { Button } from '../ui/Button'
import type { ExportResult, JobInfo } from '../api/types'

export interface ExportRunViewProps {
  job: JobInfo | undefined
  filename: string
  onCancel: () => void
  onClose: () => void
}

function isResult(r: JobInfo['result']): r is ExportResult {
  return !!r && 'filename' in r
}

/**
 * Progress of a running export: rows written so far and the rate, Cancel while running, then the outcome — the
 * downloaded file name and row count, the failure message (for example the Excel row limit), or "Cancelled".
 */
export function ExportRunView({ job, filename, onCancel, onClose }: ExportRunViewProps) {
  const running = !job || job.state === 'running'
  return (
    <div className="flex flex-col items-start gap-2 text-[13px]">
      {running && (
        <>
          <p role="status" className="m-0">
            Exporting {filename}… {(job?.progress.done ?? 0).toLocaleString()} rows
            {job && job.progress.rate_per_s > 0 && <span className="text-muted"> · {Math.round(job.progress.rate_per_s).toLocaleString()} rows/s</span>}
          </p>
          <Button onClick={onCancel}>Cancel export</Button>
        </>
      )}
      {job?.state === 'done' && (
        <p role="status" className="m-0">
          Downloaded {isResult(job.result) ? `${job.result.filename} (${job.result.rows.toLocaleString()} rows)` : filename}.
        </p>
      )}
      {job?.state === 'failed' && (
        <p role="alert" className="m-0 text-danger">
          {job.result && 'error' in job.result ? job.result.error : 'The export failed.'}
        </p>
      )}
      {job?.state === 'cancelled' && <p className="m-0 text-muted">Cancelled. The partial file was deleted.</p>}
      {!running && <Button onClick={onClose}>Close</Button>}
    </div>
  )
}
