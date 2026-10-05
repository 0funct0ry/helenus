import { api } from './client'
import type { AggregateTestResult } from './types'

/** Run an aggregate over a table (`POST /p/{profile}/aggregates/test`); the server reads at most `limit` rows. */
export function testAggregate(profile: string, keyspace: string, name: string, signature: string, table: string, columns: string[]): Promise<AggregateTestResult> {
  return api<AggregateTestResult>(`/p/${encodeURIComponent(profile)}/aggregates/test`, { body: { keyspace, name, signature, table, columns } })
}
