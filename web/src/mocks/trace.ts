import type { Message, TraceEvent } from './types'

export const traceSummary = { coordinator: '10.20.0.11', duration: '31.7 ms', events: 7, nodes: 3 }

export const traceEvents: TraceEvent[] = [
  { node: '10.20.0.11', activity: 'Parsing SELECT statement', elapsedUs: 0, thread: 'Native-Transport-Requests-4' },
  { node: '10.20.0.11', activity: 'Preparing statement', elapsedUs: 410, thread: 'Native-Transport-Requests-4' },
  { node: '10.20.0.11', activity: 'Executing single-partition query on transactions_by_merchant', elapsedUs: 980, thread: 'ReadStage-2' },
  { node: '10.20.0.12', activity: 'Acquiring sstable references', elapsedUs: 4200, thread: 'ReadStage-1' },
  { node: '10.20.0.12', activity: 'Merged data from memtables and 2 sstables', elapsedUs: 12400, thread: 'ReadStage-1' },
  { node: '10.20.0.11', activity: 'Read 6 live rows and 1204 tombstone cells', elapsedUs: 24100, thread: 'ReadStage-2' },
  { node: '10.20.0.11', activity: 'Request complete', elapsedUs: 31700, thread: 'Native-Transport-Requests-4' },
]

export const messages: Message[] = [
  {
    id: 'm1',
    level: 'info',
    text: 'Executed at QUORUM with tracing on',
    detail: "SELECT txn_time, amount, currency, status, tags FROM payments.transactions_by_merchant WHERE merchant_id = 7c9e6679-7425-40de-944b-e07fc1f90ae7 AND txn_day = '2026-09-30' LIMIT 50;",
  },
  {
    id: 'm2',
    level: 'warning',
    text: 'Cassandra returned a warning: Read 6 live rows and 1,204 tombstone cells for query in partition (7c9e6679…, 2026-09-30). Consider reviewing TTLs or compaction for this table.',
  },
]
