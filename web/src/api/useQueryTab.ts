import { useCallback } from 'react'
import { ApiError } from './client'
import { abortInflight, beginInflight, endInflight } from './inflight'
import { useRunQuery, useSplit } from './hooks'
import { byteOffset, hasIf, statementAt, toCount } from '../lib/statements'
import { useWorkspace } from '../store/workspace'
import type { QueryTabState, ResultError, StatementResult } from '../store/workspace'
import type { QueryRequest, QueryResponse } from './types'

let seq = 0

function toError(e: unknown): ResultError {
  if (e instanceof ApiError) return { code: e.code, message: e.message, detail: e.detail }
  return { code: 'error', message: e instanceof Error ? e.message : String(e) }
}

/** Build the request body for a statement from the tab's settings. */
export function buildRequest(st: QueryTabState, cql: string, pageState: string | null, filtering: boolean): QueryRequest {
  return {
    cql,
    keyspace: st.keyspace,
    consistency: st.consistency,
    serial_consistency: hasIf(cql) ? st.serial : '',
    page_size: st.pageSize,
    page_state: pageState,
    allow_filtering: filtering || st.allowFiltering,
    trace: st.trace,
  }
}

/**
 * Execution for one query tab: run the statement under the cursor, run all statements, cancel,
 * page forward/back through the page-state stack, re-run with ALLOW FILTERING, and count rows.
 * State lives in the workspace store so it survives tab switches; a running request is tracked by
 * tab id so Cancel and closing the tab abort it.
 */
export function useQueryTab(tabId: string) {
  const profile = useWorkspace((s) => s.profileId)
  const patch = useWorkspace((s) => s.patchQuery)
  const run = useRunQuery(profile)
  const split = useSplit(profile)

  const current = () => useWorkspace.getState().queryStates[tabId]
  const setResult = useCallback(
    (index: number, r: Partial<StatementResult>) => {
      const st = useWorkspace.getState().queryStates[tabId]
      if (!st) return
      const results = st.results.map((x, i) => (i === index ? { ...x, ...r } : x))
      patch(tabId, { results })
    },
    [tabId, patch],
  )

  /** Execute `cql` into result slot `index`. Returns true on success. */
  const exec = useCallback(
    async (index: number, cql: string, pageStates: (string | null)[], filtering: boolean, signal: AbortSignal): Promise<boolean> => {
      setResult(index, { cql, status: 'running', error: undefined, pageStates, filtering })
      try {
        const res: QueryResponse = await run(buildRequest(current(), cql, pageStates[pageStates.length - 1], filtering), signal)
        setResult(index, { status: 'done', response: res })
        if (res.keyspace_after) patch(tabId, { keyspace: res.keyspace_after })
        return true
      } catch (e) {
        setResult(index, { status: 'error', error: toError(e), response: undefined })
        return false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, setResult, tabId, patch],
  )

  const guarded = async (fn: (signal: AbortSignal) => Promise<void>) => {
    const signal = beginInflight(tabId)
    patch(tabId, { running: true })
    try {
      await fn(signal)
    } finally {
      endInflight(tabId, signal)
      patch(tabId, { running: false })
    }
  }

  /** Run the statement containing UTF-16 cursor index `pos`. */
  const runOne = (text: string, pos: number) =>
    guarded(async (signal) => {
      const stmts = (await split(text)).filter((s) => s.text.trim())
      const stmt = statementAt(stmts, byteOffset(text, pos))
      if (!stmt) return
      patch(tabId, { results: [{ id: `r${++seq}`, cql: stmt.text, status: 'running', pageStates: [null] }], activeResult: 0 })
      await exec(0, stmt.text, [null], false, signal)
    })

  /** Run every statement in order, one result tab each, stopping at the first error. */
  const runAll = (text: string) =>
    guarded(async (signal) => {
      const stmts = (await split(text)).filter((s) => s.text.trim())
      if (!stmts.length) return
      patch(tabId, { results: stmts.map((s) => ({ id: `r${++seq}`, cql: s.text, status: 'running' as const, pageStates: [null] })), activeResult: 0 })
      for (let i = 0; i < stmts.length; i++) {
        patch(tabId, { activeResult: i })
        if (!(await exec(i, stmts[i].text, [null], false, signal))) {
          // later statements never ran: drop their placeholders
          patch(tabId, { results: current().results.slice(0, i + 1) })
          return
        }
      }
    })

  const cancel = () => abortInflight(tabId)

  /** Load the next (dir=1) or previous (dir=-1) page of result `index`. */
  const page = (index: number, dir: 1 | -1) =>
    guarded(async (signal) => {
      const r = current().results[index]
      if (!r) return
      let states = r.pageStates
      if (dir === 1) {
        if (!r.response?.page_state) return
        states = [...states, r.response.page_state]
      } else {
        if (states.length < 2) return
        states = states.slice(0, -1)
      }
      await exec(index, r.cql, states, !!r.filtering, signal)
    })

  /** Re-run result `index` with ALLOW FILTERING for this execution only. */
  const runWithFiltering = (index: number) =>
    guarded(async (signal) => {
      const r = current().results[index]
      if (r) await exec(index, r.cql, [null], true, signal)
    })

  /** Run `SELECT COUNT(*)` for result `index` and resolve to the count text. */
  const count = async (index: number): Promise<string> => {
    const r = current().results[index]
    const cql = r ? toCount(r.response?.executed_cql ?? r.cql) : undefined
    if (!cql) throw new Error('Counting is only available for SELECT statements.')
    const key = `${tabId}:count`
    const signal = beginInflight(key)
    try {
      const res = await run(buildRequest(current(), cql, null, !!r.filtering), signal)
      return String(res.rows[0]?.[0] ?? '0')
    } finally {
      endInflight(key, signal)
    }
  }

  return { runOne, runAll, cancel, page, runWithFiltering, count }
}
