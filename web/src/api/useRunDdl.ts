import { useCallback } from 'react'
import { useRunQuery } from './hooks'
import { useWorkspace } from '../store/workspace'
import { describeError } from './client'

/**
 * Returns a function that runs one DDL statement through `/query` as UI-issued DDL (logged in the schema change history, and the schema cache refreshes on a
 * schema change). It resolves to an error message, or `null` on success.
 */
export function useRunDdl(profile: string) {
  const run = useRunQuery(profile)
  const consistency = useWorkspace((s) => s.consistency)
  return useCallback(
    async (cql: string, keyspace: string): Promise<string | null> => {
      try {
        await run({ cql, keyspace, consistency, serial_consistency: 'SERIAL', page_size: 100, page_state: null, allow_filtering: false, trace: false, ddl_origin: 'ui' })
        return null
      } catch (e) {
        return describeError(e)
      }
    },
    [run, consistency],
  )
}
