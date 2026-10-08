import { useEffect } from 'react'
import { api } from './client'
import { newQueryState, useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

interface SavedState {
  tabs: WorkspaceTab[]
  activeId: string
  queries: Record<string, { text: string; keyspace: string; savedText?: string; savedVersion?: number }>
}

const SAVE_DELAY_MS = 1000

function snapshot(): SavedState {
  const s = useWorkspace.getState()
  const queries: SavedState['queries'] = {}
  for (const t of s.tabs) {
    const q = s.queryStates[t.id]
    if (t.kind === 'query' && q) queries[t.id] = { text: q.text, keyspace: q.keyspace, savedText: q.savedText, savedVersion: q.savedVersion }
  }
  return { tabs: s.tabs.map(({ initialCql, ...t }) => { void initialCql; return t }), activeId: s.activeId, queries }
}

/**
 * With sign-in on, restores the user's saved tabs for `profile` once (when none are open) and then
 * saves the open tabs and query text after each change. Does nothing while `enabled` is false.
 */
export function useUiStateSync(enabled: boolean, profile: string) {
  useEffect(() => {
    if (!enabled || !profile) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    const path = `/p/${encodeURIComponent(profile)}/ui-state`
    api<{ state: SavedState | null }>(path)
      .then(({ state }) => {
        if (cancelled) return
        if (state?.tabs?.length && useWorkspace.getState().tabs.length === 0) {
          const queryStates = Object.fromEntries(
            Object.entries(state.queries ?? {}).map(([id, q]) => [id, newQueryState({ text: q.text, keyspace: q.keyspace, savedText: q.savedText, savedVersion: q.savedVersion }, useWorkspace.getState().consistency)]),
          )
          useWorkspace.setState({ tabs: state.tabs, activeId: state.activeId, queryStates })
        }
        unsubscribe = useWorkspace.subscribe((s, prev) => {
          if (s.tabs === prev.tabs && s.activeId === prev.activeId && s.queryStates === prev.queryStates) return
          clearTimeout(timer)
          timer = setTimeout(() => void api(path, { method: 'PUT', body: snapshot() }).catch(() => undefined), SAVE_DELAY_MS)
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      clearTimeout(timer)
      unsubscribe?.()
    }
  }, [enabled, profile])
}
