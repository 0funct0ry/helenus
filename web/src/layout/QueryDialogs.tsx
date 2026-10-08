import { useEffect, useRef } from 'react'
import { SaveQueryDialog } from './SaveQueryDialog'
import { UnsavedQueryDialog } from './UnsavedQueryDialog'
import { QueryConflictDialog } from './QueryConflictDialog'
import { getSavedQuery } from '../api/useQueries'
import { describeError } from '../api/client'
import { useQueryActions } from '../api/useQueryActions'
import { FILE_ACCEPT } from '../lib/files'
import { useQueryDialogs } from '../store/queryDialogs'
import { useToasts } from '../store/toast'
import { useWorkspace } from '../store/workspace'

/**
 * Host for the saved-query dialogs (Save as, Rename / Move, unsaved changes, conflict), driven by the
 * queryDialogs store, plus the hidden file input behind "Open .cql file…". Mounted once in the app shell.
 */
export function QueryDialogs() {
  const profile = useWorkspace((s) => s.profileId)
  const tabs = useWorkspace((s) => s.tabs)
  const { saveAs, unsaved, conflict, rename, pickerNonce, set } = useQueryDialogs()
  const actions = useQueryActions()
  const input = useRef<HTMLInputElement>(null)
  const seen = useRef(pickerNonce)
  const toast = useToasts((s) => s.push)

  useEffect(() => {
    if (pickerNonce === seen.current) return
    seen.current = pickerNonce
    input.current?.click()
  }, [pickerNonce])

  const textOf = (id: string) => useWorkspace.getState().queryStates[id]?.text ?? ''
  const unsavedTab = tabs.find((t) => t.id === unsaved)

  const reload = async () => {
    if (!conflict) return
    const { tabId, current } = conflict
    set({ conflict: null })
    try {
      const row = current.text === undefined ? await getSavedQuery(profile, current.id) : current
      useWorkspace.getState().reloadQuery(tabId, row.text ?? '', row.version)
    } catch (e) {
      toast(`Could not reload: ${describeError(e)}`)
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        aria-label="Open .cql file"
        className="hidden"
        data-testid="cql-file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          for (const f of files) void actions.openFile(f)
        }}
      />
      {saveAs && (
        <SaveQueryDialog
          key={`${saveAs.tabId}:${saveAs.name}`}
          profile={profile}
          text={textOf(saveAs.tabId)}
          initialName={saveAs.name}
          initialGlobal={tabs.find((t) => t.id === saveAs.tabId)?.queryGlobal}
          onSaved={(row) => {
            actions.bindSaved(saveAs.tabId, row, textOf(saveAs.tabId))
            if (saveAs.closeAfter) useWorkspace.getState().close(saveAs.tabId)
          }}
          onClose={() => set({ saveAs: null })}
        />
      )}
      {rename && (
        <SaveQueryDialog
          profile={profile}
          mode="rename"
          existing={rename}
          initialName={rename.name}
          onSaved={(row) => {
            useWorkspace.getState().syncBoundQuery(row)
            toast(`Renamed to ${row.name}`)
          }}
          onClose={() => set({ rename: null })}
        />
      )}
      {unsaved && unsavedTab && (
        <UnsavedQueryDialog
          title={unsavedTab.title}
          onCancel={() => set({ unsaved: null })}
          onDiscard={() => {
            set({ unsaved: null })
            useWorkspace.getState().close(unsaved)
          }}
          onSave={() => {
            set({ unsaved: null })
            void actions.save(unsaved, true)
          }}
        />
      )}
      {conflict && (
        <QueryConflictDialog
          name={conflict.current.name}
          onCancel={() => set({ conflict: null })}
          onOverwrite={() => {
            set({ conflict: null })
            void actions.overwrite(conflict.tabId, conflict.current, conflict.closeAfter)
          }}
          onSaveAsCopy={() => {
            set({ conflict: null })
            actions.saveAs(conflict.tabId, `${conflict.current.name} copy`, conflict.closeAfter)
          }}
          onReload={() => void reload()}
        />
      )}
    </>
  )
}
