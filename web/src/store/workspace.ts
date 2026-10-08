import { create } from 'zustand'
import { emptyColumnView } from '../lib/columnView'
import type { ColumnView } from '../lib/columnView'
import type { ProfileStatus } from '../lib/schemaModel'
import type { QueryResponse } from '../api/types'
import { abortInflight } from '../api/inflight'
import { stage, unstage } from '../lib/changes'
import type { PendingItem } from '../lib/changes'

export type TabKind = 'table' | 'view' | 'query' | 'type' | 'function' | 'aggregate' | 'security'

export interface WorkspaceTab {
  id: string
  kind: TabKind
  title: string
  keyspace: string
  /** Table, view or type name, a function or aggregate signature; empty for query tabs. */
  object: string
  closable: boolean
  /** Text a query tab starts with. */
  initialCql?: string
  /** Id of the saved query this query tab is bound to; unbound tabs have none. */
  savedQueryId?: number
  /** Full library name of the bound query (`reports/daily`). */
  queryName?: string
  /** Whether the bound query is global (all profiles). */
  queryGlobal?: boolean
}

/** An API error as shown in a result (SPEC §11). */
export interface ResultError {
  code: string
  message: string
  detail?: Record<string, unknown>
}

/** The outcome of one executed statement in a query tab. */
export interface StatementResult {
  id: string
  cql: string
  status: 'running' | 'done' | 'error'
  response?: QueryResponse
  error?: ResultError
  /** Page state used to load each visited page; the last entry is the current page (null for the first). */
  pageStates: (string | null)[]
  /** One-shot ALLOW FILTERING used for this statement (offered after a filtering error). */
  filtering?: boolean
}

/** Everything a query tab remembers between renders and tab switches. */
export interface QueryTabState {
  text: string
  keyspace: string
  consistency: string
  serial: string
  pageSize: number
  allowFiltering: boolean
  trace: boolean
  running: boolean
  results: StatementResult[]
  activeResult: number
  /** Text last saved to the library for a bound tab; the tab is dirty when `text` differs. */
  savedText?: string
  /** Library version `savedText` was saved at; sent with the next save. */
  savedVersion?: number
}

export const DEFAULT_QUERY_TEXT = '-- Write CQL here. Cmd+Enter runs the statement under the cursor.\n'

/** Fresh state for a query tab. */
export function newQueryState(over: Partial<QueryTabState> = {}, consistency = 'LOCAL_QUORUM'): QueryTabState {
  return { text: DEFAULT_QUERY_TEXT, keyspace: '', consistency, serial: 'SERIAL', pageSize: 100, allowFiltering: false, trace: false, running: false, results: [], activeResult: 0, ...over }
}

/** The library fields a bound tab mirrors. */
export interface BoundQuery {
  id: number
  name: string
  global: boolean
  version: number
}

export interface NewQueryOptions {
  keyspace?: string
  cql?: string
  /** Tab title; defaults to `query-N.cql`. */
  title?: string
  savedQueryId?: number
  queryName?: string
  queryGlobal?: boolean
  savedText?: string
  savedVersion?: number
}

/** Tab title for a saved query: last name segment plus `.cql`. */
function titleOf(name: string): string {
  return `${name.slice(name.lastIndexOf('/') + 1).replace(/\.cql$/i, '')}.cql`
}

export interface Connection {
  status: ProfileStatus
  error?: string
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeId: string
  /** Name of the active profile; empty until profiles load. */
  profileId: string
  connections: Record<string, Connection>
  queryStates: Record<string, QueryTabState>
  /** Column selection, sort, filters and hidden columns per results tab; in memory only. */
  columnViews: Record<string, ColumnView>
  updateColumnView: (id: string, fn: (v: ColumnView) => ColumnView) => void
  /** Staged grid edits per table tab, in the order they were made. They survive tab switches. */
  edits: Record<string, PendingItem[]>
  /** The last apply error of each staged item, by tab then item id. */
  editErrors: Record<string, Record<string, string>>
  stageEdit: (tabId: string, item: PendingItem) => void
  unstageEdit: (tabId: string, itemId: string) => void
  /** Replace a tab's staged edits (after an apply); `errors` marks the items that failed. */
  setEdits: (tabId: string, items: PendingItem[], errors?: Record<string, string>) => void
  clearEdits: (tabId: string) => void
  /** Merge `patch` into a query tab's state, creating it if needed. */
  patchQuery: (id: string, patch: Partial<QueryTabState>) => void
  setConnection: (name: string, status: ProfileStatus, error?: string) => void
  clearConnection: (name: string) => void
  paletteOpen: boolean
  /** Keyspace whose data model is being reviewed, or null. */
  reviewKeyspace: string | null
  setReviewKeyspace: (ks: string | null) => void
  profileDialogOpen: boolean
  queryCount: number
  consistency: string
  /** Bumped when table data changed outside the grid (for example a truncate) so open Data views reload. */
  dataEpoch: number
  bumpDataEpoch: () => void
  cursor: { line: number; col: number }
  setConsistency: (c: string) => void
  setCursor: (line: number, col: number) => void
  open: (kind: Exclude<TabKind, 'query'>, keyspace: string, object: string) => void
  newQuery: (opts?: NewQueryOptions) => void
  /** Bind a query tab to a saved query: sets its title, name, scope and saved text/version. */
  bindQuery: (tabId: string, row: BoundQuery, text: string) => void
  /** Apply a renamed/moved/re-versioned saved query to every tab bound to it. */
  syncBoundQuery: (row: BoundQuery & { text?: string }) => void
  /** Detach every tab bound to `queryId` (text stays); returns the titles of the tabs affected. */
  unbindQuery: (queryId: number) => string[]
  /** Replace a bound tab's text and saved state and remount its editor. */
  reloadQuery: (tabId: string, text: string, version: number) => void
  /** Bumped per tab when its editor must remount to show replaced text. */
  editorEpochs: Record<string, number>
  close: (id: string) => void
  /** Close several tabs in one update; `activeAfter` becomes active if the active tab is among them. */
  closeMany: (ids: string[], activeAfter?: string) => void
  activate: (id: string) => void
  setProfile: (id: string) => void
  setPaletteOpen: (open: boolean) => void
  setProfileDialogOpen: (open: boolean) => void
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeId: '',
  profileId: '',
  connections: {},
  queryStates: {},
  columnViews: {},
  updateColumnView: (id, fn) => set((s) => ({ columnViews: { ...s.columnViews, [id]: fn(s.columnViews[id] ?? emptyColumnView) } })),
  edits: {},
  editErrors: {},
  stageEdit: (tabId, item) =>
    set((s) => ({ edits: { ...s.edits, [tabId]: stage(s.edits[tabId] ?? [], item) }, editErrors: { ...s.editErrors, [tabId]: {} } })),
  unstageEdit: (tabId, itemId) => set((s) => ({ edits: { ...s.edits, [tabId]: unstage(s.edits[tabId] ?? [], itemId) } })),
  setEdits: (tabId, items, errors = {}) => set((s) => ({ edits: { ...s.edits, [tabId]: items }, editErrors: { ...s.editErrors, [tabId]: errors } })),
  clearEdits: (tabId) =>
    set((s) => {
      const edits = { ...s.edits }
      const editErrors = { ...s.editErrors }
      delete edits[tabId]
      delete editErrors[tabId]
      return { edits, editErrors }
    }),
  patchQuery: (id, patch) =>
    set((s) => ({ queryStates: { ...s.queryStates, [id]: { ...(s.queryStates[id] ?? newQueryState({}, s.consistency)), ...patch } } })),
  setConnection: (name, status, error) => set((s) => ({ connections: { ...s.connections, [name]: { status, error } } })),
  clearConnection: (name) =>
    set((s) => {
      const connections = { ...s.connections }
      delete connections[name]
      return { connections }
    }),
  paletteOpen: false,
  reviewKeyspace: null,
  profileDialogOpen: false,
  queryCount: 0,
  consistency: 'LOCAL_QUORUM',
  cursor: { line: 1, col: 1 },
  setConsistency: (consistency) => set({ consistency }),
  setCursor: (line, col) => set({ cursor: { line, col } }),
  open: (kind, keyspace, object) => {
    const id = `${kind}:${keyspace}.${object}`
    const exists = get().tabs.some((t) => t.id === id)
    set((s) => ({
      tabs: exists ? s.tabs : [...s.tabs, { id, kind, title: object, keyspace, object, closable: true }],
      activeId: id,
    }))
  },
  newQuery: (opts) => {
    let n = get().queryCount + 1
    while (get().tabs.some((t) => t.id === `query-${n}`)) n++
    const id = `query-${n}`
    const bound = opts?.savedQueryId !== undefined
    set((s) => ({
      queryCount: n,
      queryStates: {
        ...s.queryStates,
        [id]: newQueryState(
          { keyspace: opts?.keyspace ?? '', text: opts?.cql ?? DEFAULT_QUERY_TEXT, ...(bound && { savedText: opts?.savedText ?? opts?.cql ?? '', savedVersion: opts?.savedVersion }) },
          s.consistency,
        ),
      },
      tabs: [
        ...s.tabs,
        {
          id,
          kind: 'query',
          title: opts?.title ?? `query-${n}.cql`,
          keyspace: opts?.keyspace ?? '',
          object: '',
          closable: true,
          initialCql: opts?.cql,
          ...(bound && { savedQueryId: opts.savedQueryId, queryName: opts.queryName, queryGlobal: opts.queryGlobal }),
        },
      ],
      activeId: id,
    }))
  },
  editorEpochs: {},
  bindQuery: (tabId, row, text) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title: titleOf(row.name), savedQueryId: row.id, queryName: row.name, queryGlobal: row.global } : t)),
      queryStates: { ...s.queryStates, [tabId]: { ...(s.queryStates[tabId] ?? newQueryState({}, s.consistency)), savedText: text, savedVersion: row.version } },
    })),
  syncBoundQuery: (row) =>
    set((s) => {
      const bound = s.tabs.filter((t) => t.savedQueryId === row.id).map((t) => t.id)
      if (bound.length === 0) return {}
      const queryStates = { ...s.queryStates }
      for (const id of bound) {
        const q = queryStates[id]
        // Only adopt the new version when the tab's saved text is what the library holds, so a hidden change is still reported as a conflict.
        if (q && (row.text === undefined || row.text === q.savedText)) queryStates[id] = { ...q, savedVersion: row.version }
      }
      return {
        tabs: s.tabs.map((t) => (t.savedQueryId === row.id ? { ...t, title: titleOf(row.name), queryName: row.name, queryGlobal: row.global } : t)),
        queryStates,
      }
    }),
  unbindQuery: (queryId) => {
    const hit = get().tabs.filter((t) => t.savedQueryId === queryId)
    if (hit.length === 0) return []
    const ids = new Set(hit.map((t) => t.id))
    set((s) => ({
      tabs: s.tabs.map((t) => (ids.has(t.id) ? { ...t, savedQueryId: undefined, queryName: undefined, queryGlobal: undefined } : t)),
      queryStates: Object.fromEntries(Object.entries(s.queryStates).map(([k, q]) => [k, ids.has(k) ? { ...q, savedText: undefined, savedVersion: undefined } : q])),
    }))
    return hit.map((t) => t.title)
  },
  reloadQuery: (tabId, text, version) =>
    set((s) => ({
      queryStates: { ...s.queryStates, [tabId]: { ...(s.queryStates[tabId] ?? newQueryState({}, s.consistency)), text, savedText: text, savedVersion: version } },
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, initialCql: text } : t)),
      editorEpochs: { ...s.editorEpochs, [tabId]: (s.editorEpochs[tabId] ?? 0) + 1 },
    })),
  dataEpoch: 0,
  bumpDataEpoch: () => set((s) => ({ dataEpoch: s.dataEpoch + 1 })),
  close: (id) => get().closeMany([id]),
  closeMany: (ids, activeAfter) => {
    const gone = new Set(get().tabs.filter((t) => ids.includes(t.id)).map((t) => t.id))
    if (gone.size === 0) return
    gone.forEach((id) => abortInflight(id))
    set((s) => {
      const tabs = s.tabs.filter((t) => !gone.has(t.id))
      const drop = <T,>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([k]) => !gone.has(k)))
      let activeId = s.activeId
      if (gone.has(s.activeId)) {
        if (activeAfter && tabs.some((t) => t.id === activeAfter)) activeId = activeAfter
        else {
          const before = s.tabs.slice(0, s.tabs.findIndex((t) => t.id === s.activeId)).filter((t) => !gone.has(t.id)).length
          activeId = tabs[Math.min(before, tabs.length - 1)]?.id ?? ''
        }
      }
      return { tabs, activeId, editorEpochs: drop(s.editorEpochs), queryStates: drop(s.queryStates), columnViews: drop(s.columnViews), edits: drop(s.edits), editErrors: drop(s.editErrors) }
    })
  },
  activate: (id) => set({ activeId: id }),
  setProfile: (id) => set({ profileId: id }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setReviewKeyspace: (reviewKeyspace) => set({ reviewKeyspace }),
  setProfileDialogOpen: (profileDialogOpen) => set({ profileDialogOpen }),
}))
