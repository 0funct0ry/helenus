import { useRef, useState } from 'react'
import { Loader } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { Button } from '../ui/Button'
import { useCancelJob, useJobs } from '../api/useSeed'
import type { JobInfo, SeedResult } from '../api/types'

export interface JobsIndicatorProps {
  profile: string
  /** Fetch only while connected. */
  enabled: boolean
  className?: string
}

function describe(j: JobInfo): string {
  const r = j.result && 'written' in j.result ? (j.result as SeedResult) : undefined
  const target = r ? `${r.keyspace}.${r.table}` : j.kind
  const pct = j.progress.total ? Math.round((j.progress.done / j.progress.total) * 100) : 0
  return j.state === 'running' ? `${target} · ${pct}% (${j.progress.done.toLocaleString()}/${j.progress.total.toLocaleString()})` : `${target} · ${j.state}`
}

/**
 * Status-bar "Jobs" button. It appears while this helenus process has jobs for the profile, shows how many are
 * running, and opens a list with progress and a Cancel button per running job. Jobs are lost when helenus restarts.
 */
export function JobsIndicator({ profile, enabled, className }: JobsIndicatorProps) {
  const { data: jobs = [] } = useJobs(profile, enabled)
  const cancel = useCancelJob(profile)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  if (!jobs.length) return null
  const running = jobs.filter((j) => j.state === 'running')
  return (
    <>
      <button ref={ref} type="button" aria-label={`Jobs, ${running.length} running`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${className ?? ''} hover:bg-hover`}>
        {running.length > 0 && <Loader size={12} className="animate-spin" aria-hidden />}
        Jobs{running.length > 0 ? ` (${running.length})` : ''}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} aria-label="Jobs" className="w-[340px] p-2">
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {jobs.slice(0, 10).map((j) => (
            <li key={j.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{describe(j)}</span>
              {j.state === 'running' && <Button onClick={() => cancel.mutate(j.id)}>Cancel</Button>}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 text-xs text-muted">Jobs are lost when helenus restarts.</p>
      </Popover>
    </>
  )
}
