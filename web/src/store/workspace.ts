import { create } from 'zustand'
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
}

export const DEFAULT_QUERY_TEXT = '-- Write CQL here. Cmd+Enter runs the statement under the cursor.\n'

/** Fresh state for a query tab. */
export function newQueryState(over: Partial<QueryTabState> = {}, consistency = 'LOCAL_QUORUM'): QueryTabState {
  return { text: DEFAULT_QUERY_TEXT, keyspace: '', consistency, serial: 'SERIAL', pageSize: 100, allowFiltering: false, trace: false, running: false, results: [], activeResult: 0, ...over }
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
  newQuery: (opts?: { keyspace?: string; cql?: string }) => void
  close: (id: string) => void
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
    const n = get().queryCount + 1
    const id = `query-${n}`
    set((s) => ({
      queryCount: n,
      queryStates: { ...s.queryStates, [id]: newQueryState({ keyspace: opts?.keyspace ?? '', text: opts?.cql ?? DEFAULT_QUERY_TEXT }, s.consistency) },
      tabs: [...s.tabs, { id, kind: 'query', title: `query-${n}.cql`, keyspace: opts?.keyspace ?? '', object: '', closable: true, initialCql: opts?.cql }],
      activeId: id,
    }))
  },
  dataEpoch: 0,
  bumpDataEpoch: () => set((s) => ({ dataEpoch: s.dataEpoch + 1 })),
  close: (id) => {
    abortInflight(id)
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      if (i < 0) return s
      const tabs = s.tabs.filter((t) => t.id !== id)
      const queryStates = { ...s.queryStates }
      delete queryStates[id]
      const edits = { ...s.edits }
      const editErrors = { ...s.editErrors }
      delete edits[id]
      delete editErrors[id]
      const activeId = s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? '') : s.activeId
      return { tabs, activeId, queryStates, edits, editErrors }
    })
  },
  activate: (id) => set({ activeId: id }),
  setProfile: (id) => set({ profileId: id }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setProfileDialogOpen: (profileDialogOpen) => set({ profileDialogOpen }),
}))
