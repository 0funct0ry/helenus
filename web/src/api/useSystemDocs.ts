import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface SystemTableDoc {
  description: string
  columns?: Record<string, string>
}
export interface SystemKeyspaceDoc {
  description: string
  tables: Record<string, SystemTableDoc>
}
export interface SystemDocs {
  keyspaces: Record<string, SystemKeyspaceDoc>
}

/** The embedded catalog of system keyspace and table descriptions; it ships in the binary, so it never goes stale. */
export function useSystemDocs() {
  return useQuery({ queryKey: ['system-docs'], staleTime: Infinity, queryFn: () => api<SystemDocs>('/system-docs') })
}

/** Text shown for a system table that has no catalog entry. */
export const NO_DESCRIPTION = 'No description available'
