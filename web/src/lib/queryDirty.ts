import type { QueryTabState, WorkspaceTab } from '../store/workspace'

/** A bound query tab is dirty when its text differs from the text last saved; unbound tabs are never dirty. */
export function isDirtyTab(tab: Pick<WorkspaceTab, 'kind' | 'savedQueryId'>, state: Pick<QueryTabState, 'text' | 'savedText'> | undefined): boolean {
  return tab.kind === 'query' && tab.savedQueryId !== undefined && !!state && state.text !== (state.savedText ?? state.text)
}
