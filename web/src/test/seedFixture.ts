import type { JobInfo, SeedColumnInfo, SeedConfig, SeedPreview, SeedSpec } from '../api/types'

const col = (name: string, type: string, kind: SeedColumnInfo['kind'], compatible: string[]): SeedColumnInfo => ({
  name,
  type,
  desc: { name: type },
  kind,
  key: kind === 'partition' || kind === 'clustering',
  compatible,
})

export const seedColumns: SeedColumnInfo[] = [
  col('id', 'uuid', 'partition', ['constant', 'null', 'uuid']),
  col('email', 'text', 'regular', ['constant', 'null', 'sequence', 'regex', 'fake', 'choice']),
  col('created', 'timestamp', 'regular', ['constant', 'null', 'time_range', 'choice']),
]

export const seedSpecs: Record<string, SeedSpec> = {
  id: { type: 'uuid', gen: 'uuid' },
  email: { type: 'text', gen: 'fake', params: { category: 'email' } },
  created: { type: 'timestamp', gen: 'time_range', params: { from: 'now-30d', to: 'now' } },
}

export const seedConfig: SeedConfig = {
  seed: 42,
  total_rows: 1000,
  rows_per_partition: 100,
  concurrency: 8,
  consistency: 'LOCAL_QUORUM',
  ttl: 0,
  if_not_exists: false,
  columns: seedSpecs,
}

export const seedRows: unknown[][] = Array.from({ length: 20 }, (_, i) => [
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  `ada.lovelace${i}@example.com`,
  '2025-01-02T03:04:05.000Z',
])

export function seedPreview(over: Partial<SeedPreview> = {}): SeedPreview {
  return {
    config: seedConfig,
    columns: seedColumns,
    notes: [],
    errors: [],
    rows: seedRows,
    statement: "INSERT INTO payments.merchants (id, email) VALUES (00000000-0000-4000-8000-000000000000, 'ada.lovelace0@example.com');",
    counter: false,
    partitions: 1000,
    ...over,
  }
}

export function seedJob(over: Partial<JobInfo> = {}): JobInfo {
  return {
    id: 'job1',
    kind: 'seed',
    profile: 'local',
    state: 'running',
    progress: { done: 250, total: 1000, errors: 0, rate_per_s: 500, eta_s: 1.5 },
    started_at: '2025-01-01T00:00:00Z',
    ...over,
  }
}
