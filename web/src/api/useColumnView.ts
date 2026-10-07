import { useCallback, useState } from 'react'
import { emptyColumnView } from '../lib/columnView'
import type { ColumnView } from '../lib/columnView'
import { useWorkspace } from '../store/workspace'

/**
 * Column selection, sort, filters and hidden columns of a results grid. With a tab id the state lives in the
 * workspace store, so switching tabs keeps it; without one (a grid outside a tab) it is local component state.
 * Nothing is persisted across reloads.
 */
export function useColumnView(tabId?: string): [ColumnView, (fn: (v: ColumnView) => ColumnView) => void] {
  const stored = useWorkspace((s) => (tabId ? s.columnViews[tabId] : undefined))
  const updateStored = useWorkspace((s) => s.updateColumnView)
  const [local, setLocal] = useState<ColumnView>(emptyColumnView)
  const update = useCallback(
    (fn: (v: ColumnView) => ColumnView) => {
      if (tabId) updateStored(tabId, fn)
      else setLocal(fn)
    },
    [tabId, updateStored],
  )
  return [tabId ? (stored ?? emptyColumnView) : local, update]
}
