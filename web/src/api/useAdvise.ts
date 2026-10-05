import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { AdviceFinding } from './types'

/** Data-model findings for one table, or for a whole keyspace when `table` is omitted. */
export function useAdvise(profile: string, keyspace: string, table: string | undefined, enabled = true) {
  const qs = new URLSearchParams({ keyspace })
  if (table) qs.set('table', table)
  return useQuery({
    queryKey: ['advise', profile, keyspace, table ?? ''],
    enabled: enabled && !!profile && !!keyspace,
    queryFn: async () => (await api<{ findings: AdviceFinding[] }>(`/p/${encodeURIComponent(profile)}/advise?${qs}`)).findings,
  })
}
