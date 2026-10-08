import type { SavedQuery } from '../api/useQueries'
import type { WorkspaceTab } from '../store/workspace'
import { useQueryDialogs } from '../store/queryDialogs'
import { useToasts } from '../store/toast'
import { useWorkspace } from '../store/workspace'
import { connectedWorkspace } from './schemaFixture'

/** A saved-query row as the API returns it. */
export function savedRow(over: Partial<SavedQuery> = {}): SavedQuery {
  return { id: 1, name: 'reports/daily', global: false, version: 1, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', ...over }
}

/** A query tab bound to saved query 1 (`reports/daily`, version 1). */
export const boundTab: WorkspaceTab = { id: 'query-1', kind: 'query', title: 'daily.cql', keyspace: 'payments', object: '', closable: true, savedQueryId: 1, queryName: 'reports/daily', queryGlobal: false }

/** Reset the workspace, dialogs and toasts; open `tabs` with `texts` as `{text, savedText}` per tab id. */
export function boundWorkspace(tabs: WorkspaceTab[] = [boundTab], states: Record<string, { text: string; savedText?: string; savedVersion?: number }> = { 'query-1': { text: 'SELECT 1;', savedText: 'SELECT 1;', savedVersion: 1 } }) {
  connectedWorkspace(tabs)
  useWorkspace.setState({ queryStates: {}, editorEpochs: {} })
  for (const [id, st] of Object.entries(states)) useWorkspace.getState().patchQuery(id, st)
  useQueryDialogs.setState({ saveAs: null, unsaved: null, conflict: null, rename: null, pickerNonce: 0 })
  useToasts.setState({ toasts: [] })
}

export const toastMessages = () => useToasts.getState().toasts.map((t) => t.message)

/** Read a Blob's text (jsdom's Response cannot). */
export function blobText(b: Blob | undefined): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsText(b as Blob)
  })
}
