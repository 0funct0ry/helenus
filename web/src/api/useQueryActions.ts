import { useQueryClient } from '@tanstack/react-query'
import { ApiError, describeError } from './client'
import { getSavedQuery, queriesKey, updateSavedQuery } from './useQueries'
import type { SavedQuery } from './useQueries'
import { downloadText, readTextFile } from '../lib/files'
import { isDirtyTab } from '../lib/queryDirty'
import { queryTabTitle } from '../lib/queryName'
import { useQueryDialogs } from '../store/queryDialogs'
import { useToasts } from '../store/toast'
import { useWorkspace } from '../store/workspace'

/**
 * Imperative actions behind the saved-query UI (Save, Save as, open, close, download, open file). They read the
 * workspace store at call time, so they can be called from key handlers, menus and dialogs alike, and they show toasts
 * and open dialogs themselves.
 */
export function useQueryActions() {
  const qc = useQueryClient()
  const profile = () => useWorkspace.getState().profileId
  const toast = (m: string) => useToasts.getState().push(m)
  const dialogs = () => useQueryDialogs.getState()
  const refresh = () => void qc.invalidateQueries({ queryKey: queriesKey(profile()) })

  const tabOf = (tabId: string) => useWorkspace.getState().tabs.find((t) => t.id === tabId)
  const textOf = (tabId: string) => useWorkspace.getState().queryStates[tabId]?.text ?? ''

  /** Write the tab's text to its bound query at `version`; resolves true when saved. */
  const putBound = async (tabId: string, version: number, closeAfter?: boolean): Promise<boolean> => {
    const tab = tabOf(tabId)
    if (!tab || tab.savedQueryId === undefined) return false
    const text = textOf(tabId)
    try {
      const row = await updateSavedQuery(profile(), tab.savedQueryId, { name: tab.queryName ?? '', text, global: !!tab.queryGlobal, version })
      useWorkspace.getState().bindQuery(tabId, row, text)
      refresh()
      toast(`Saved ${queryTabTitle(row.name)}`)
      if (closeAfter) useWorkspace.getState().close(tabId)
      return true
    } catch (e) {
      if (e instanceof ApiError && e.code === 'query_conflict' && e.detail) {
        dialogs().set({ conflict: { tabId, current: e.detail as unknown as SavedQuery, closeAfter } })
      } else if (e instanceof ApiError && e.status === 404) {
        const titles = useWorkspace.getState().unbindQuery(tab.savedQueryId)
        refresh()
        for (const t of titles) toast(`${t} was deleted from the library; the tab is now unsaved`)
        dialogs().set({ saveAs: { tabId, name: tab.queryName ?? '', closeAfter } })
      } else {
        toast(`Could not save: ${describeError(e)}`)
      }
      return false
    }
  }

  const saveAs = (tabId: string, name?: string, closeAfter?: boolean) =>
    dialogs().set({ saveAs: { tabId, name: name ?? tabOf(tabId)?.queryName ?? '', closeAfter } })

  return {
    /** Save (⌘S): a bound tab updates its query; an unbound tab opens Save as. */
    save: (tabId: string, closeAfter?: boolean): Promise<boolean> => {
      const tab = tabOf(tabId)
      if (!tab || tab.kind !== 'query') return Promise.resolve(false)
      if (tab.savedQueryId === undefined) {
        saveAs(tabId, '', closeAfter)
        return Promise.resolve(false)
      }
      return putBound(tabId, useWorkspace.getState().queryStates[tabId]?.savedVersion ?? 0, closeAfter)
    },
    saveAs,
    /** Conflict "Overwrite": save again against the library's current version. */
    overwrite: (tabId: string, current: SavedQuery, closeAfter?: boolean) => putBound(tabId, current.version, closeAfter),
    /** Close a tab, asking first when it is a dirty bound query tab. */
    requestClose: (tabId: string) => {
      const s = useWorkspace.getState()
      const tab = s.tabs.find((t) => t.id === tabId)
      if (tab && isDirtyTab(tab, s.queryStates[tabId])) dialogs().set({ unsaved: tabId })
      else s.close(tabId)
    },
    /** Open a saved query: activates a tab already bound to it, otherwise opens a bound tab (or always a new one). */
    openQuery: async (q: Pick<SavedQuery, 'id'>, newTab = false) => {
      const s = useWorkspace.getState()
      const existing = !newTab && s.tabs.find((t) => t.kind === 'query' && t.savedQueryId === q.id)
      if (existing) {
        s.activate(existing.id)
        return
      }
      try {
        const row = await getSavedQuery(profile(), q.id)
        useWorkspace.getState().newQuery({
          cql: row.text ?? '',
          title: queryTabTitle(row.name),
          savedQueryId: row.id,
          queryName: row.name,
          queryGlobal: row.global,
          savedText: row.text ?? '',
          savedVersion: row.version,
        })
      } catch (e) {
        toast(`Could not open the query: ${describeError(e)}`)
      }
    },
    /** Create (or, for an existing query, update) is done by the Save dialog; this binds the result to its tab. */
    bindSaved: (tabId: string, row: SavedQuery, text: string) => {
      useWorkspace.getState().bindQuery(tabId, row, text)
      refresh()
      toast(`Saved ${queryTabTitle(row.name)}`)
    },
    /** Download a tab's text as its title. */
    downloadTab: (tabId: string) => {
      const tab = tabOf(tabId)
      if (tab) downloadText(tab.title.endsWith('.cql') ? tab.title : `${tab.title}.cql`, textOf(tabId))
    },
    /** Download a library query as `<last segment>.cql`. */
    downloadQuery: async (q: Pick<SavedQuery, 'id'>) => {
      try {
        const row = await getSavedQuery(profile(), q.id)
        downloadText(queryTabTitle(row.name), row.text ?? '')
      } catch (e) {
        toast(`Could not download the query: ${describeError(e)}`)
      }
    },
    /** Open a local file in a new unbound tab titled with its name; errors become toasts. */
    openFile: async (file: File) => {
      try {
        const text = await readTextFile(file)
        useWorkspace.getState().newQuery({ cql: text, title: file.name })
      } catch (e) {
        toast(`Could not open ${file.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    /** Open the file picker (rendered by QueryDialogs). */
    pickFile: () => dialogs().pickFile(),
  }
}
