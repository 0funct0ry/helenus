import type { ImportPlan, ImportPlanColumn, JobInfo } from '../api/types'

export const importColumns: ImportPlanColumn[] = [
  { target: 'user_id', type: 'uuid', kind: 'partition', source: 'UserId', confidence: 'normalized', failures: 0, samples: [] },
  { target: 'email', type: 'text', kind: 'regular', source: 'E-Mail', confidence: 'normalized', failures: 0, samples: [] },
  { target: 'created_at', type: 'timestamp', kind: 'regular', source: 'createdAt', confidence: 'normalized', failures: 2, samples: [{ line: 7, column: 'created_at', value: 'nope', reason: 'timestamp: bad' }] },
]

export function importPlan(over: Partial<ImportPlan> = {}): ImportPlan {
  return {
    format: { format: 'csv', delimiter: ';', quote: '"', header: true, null_string: '' },
    size: 2048,
    source_columns: ['UserId', 'E-Mail', 'createdAt'],
    preview: [['1', 'a@x.com', '2024-01-01']],
    columns: importColumns,
    errors: [],
    rows_checked: 10,
    ...over,
  }
}

export const importUpload = { upload: 'up1', name: 'users.csv', size: 2048, detect: { format: 'csv' as const, delimiter: ';', quote: '"', header: true } }

export function importJob(over: Partial<JobInfo> = {}): JobInfo {
  return {
    id: 'job1', kind: 'import', profile: 'local', state: 'running',
    progress: { done: 250, total: 1000, errors: 1, rate_per_s: 500, eta_s: 1.5 },
    started_at: '2026-01-01T00:00:00Z', ...over,
  }
}
