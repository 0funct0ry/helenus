import { create } from 'zustand'
import type { ProfileStatus } from '../mocks/types'

export type TabKind = 'table' | 'view' | 'query' | 'type'

export interface WorkspaceTab {
  id: string
  kind: TabKind
  title: string
  keyspace: string
  /** Table, view or type name; empty for query tabs. */
  object: string
  closable: boolean
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
  setConnection: (name: string, status: ProfileStatus, error?: string) => void
  clearConnection: (name: string) => void
  paletteOpen: boolean
  profileDialogOpen: boolean
  queryCount: number
  consistency: string
  cursor: { line: number; col: number }
  setConsistency: (c: string) => void
  setCursor: (line: number, col: number) => void
  open: (kind: Exclude<TabKind, 'query'>, keyspace: string, object: string) => void
  newQuery: () => void
  close: (id: string) => void
  activate: (id: string) => void
  setProfile: (id: string) => void
  setPaletteOpen: (open: boolean) => void
  setProfileDialogOpen: (open: boolean) => void
}

export const initialTabs: WorkspaceTab[] = [
  { id: 'table:payments.transactions_by_merchant', kind: 'table', title: 'transactions_by_merchant', keyspace: 'payments', object: 'transactions_by_merchant', closable: true },
  { id: 'query-1', kind: 'query', title: 'query-1.cql', keyspace: 'payments', object: '', closable: true },
  { id: 'type:payments.address', kind: 'type', title: 'address', keyspace: 'payments', object: 'address', closable: true },
]

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  tabs: initialTabs,
  activeId: initialTabs[0].id,
  profileId: '',
  connections: {},
  setConnection: (name, status, error) => set((s) => ({ connections: { ...s.connections, [name]: { status, error } } })),
  clearConnection: (name) =>
    set((s) => {
      const connections = { ...s.connections }
      delete connections[name]
      return { connections }
    }),
  paletteOpen: false,
  profileDialogOpen: false,
  queryCount: 1,
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
  newQuery: () => {
    const n = get().queryCount + 1
    const id = `query-${n}`
    set((s) => ({
      queryCount: n,
      tabs: [...s.tabs, { id, kind: 'query', title: `query-${n}.cql`, keyspace: 'payments', object: '', closable: true }],
      activeId: id,
    }))
  },
  close: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      if (i < 0) return s
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeId = s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? '') : s.activeId
      return { tabs, activeId }
    }),
  activate: (id) => set({ activeId: id }),
  setProfile: (id) => set({ profileId: id }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setProfileDialogOpen: (profileDialogOpen) => set({ profileDialogOpen }),
}))
