import type { Message } from './types'

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
