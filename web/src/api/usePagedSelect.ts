import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './client'
import { useRunQuery } from './hooks'
import { toCount } from '../lib/statements'
import type { QueryResponse } from './types'

export interface PagedSelect {
  response?: QueryResponse
  error?: string
  loading: boolean
  /** 1-based page number. */
  page: number
  /** Reload from the first page. */
  reload: () => void
  next: () => void
  prev: () => void
  count: () => Promise<string>
}

/**
 * Read-only paged SELECT for the Data sub-view: loads `cql` on mount and whenever its inputs change,
 * and keeps the page-state stack for Previous. The in-flight request is aborted on change/unmount.
 */
export function usePagedSelect(profile: string, keyspace: string, cql: string, consistency: string, pageSize: number, enabled: boolean): PagedSelect {
  const run = useRunQuery(profile)
  const [stack, setStack] = useState<(string | null)[]>([null])
  const [response, setResponse] = useState<QueryResponse>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const stackRef = useRef(stack)

  useEffect(() => {
    if (!enabled || !profile) return
    const ctl = new AbortController()
    setLoading(true)
    setError(undefined)
    run({ cql, keyspace, consistency, serial_consistency: '', page_size: pageSize, page_state: stack[stack.length - 1], allow_filtering: false, trace: false }, ctl.signal)
      .then((r) => {
        setResponse(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'cancelled') return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => ctl.abort()
  }, [run, enabled, profile, keyspace, cql, consistency, pageSize, stack, nonce])

  useEffect(() => {
    stackRef.current = stack
  })
  // inputs changed: back to page one
  useEffect(() => {
    setStack((s) => (s.length === 1 && s[0] === null ? s : [null]))
  }, [cql, consistency, pageSize, profile])

  const reload = useCallback(() => (stackRef.current.length === 1 ? setNonce((n) => n + 1) : setStack([null])), [])
  const next = useCallback(() => {
    if (response?.page_state) setStack((s) => [...s, response.page_state as string])
  }, [response])
  const prev = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), [])
  const count = useCallback(async () => {
    const q = toCount(cql)
    if (!q) throw new Error('Counting is only available for SELECT statements.')
    const res = await run({ cql: q, keyspace, consistency, serial_consistency: '', page_size: 100, page_state: null, allow_filtering: false, trace: false })
    return String(res.rows[0]?.[0] ?? '0')
  }, [run, cql, keyspace, consistency])

  return { response, error, loading, page: stack.length, reload, next, prev, count }
}
