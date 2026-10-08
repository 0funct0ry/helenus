import { create } from 'zustand'
import type { SavedQuery } from '../api/useQueries'

/** A Save as dialog request for a query tab. */
export interface SaveAsRequest {
  tabId: string
  /** Prefilled name (the bound name, a "copy" name, or empty). */
  name: string
  /** Close the tab once saved (from the unsaved-changes dialog). */
  closeAfter?: boolean
}

/** A save that hit a version conflict; `current` is the library's row. */
export interface ConflictRequest {
  tabId: string
  current: SavedQuery
  closeAfter?: boolean
}

interface QueryDialogState {
  saveAs: SaveAsRequest | null
  /** Tab whose close awaits the Save / Don't save / Cancel answer. */
  unsaved: string | null
  conflict: ConflictRequest | null
  /** Saved query being renamed or moved. */
  rename: SavedQuery | null
  /** Incremented to ask the host to open the .cql file picker. */
  pickerNonce: number
  set: (patch: Partial<Omit<QueryDialogState, 'set' | 'pickFile'>>) => void
  pickFile: () => void
}

/** UI state of the saved-query dialogs and the hidden file picker; the host component renders them. */
export const useQueryDialogs = create<QueryDialogState>((set) => ({
  saveAs: null,
  unsaved: null,
  conflict: null,
  rename: null,
  pickerNonce: 0,
  set: (patch) => set(patch),
  pickFile: () => set((s) => ({ pickerNonce: s.pickerNonce + 1 })),
}))
