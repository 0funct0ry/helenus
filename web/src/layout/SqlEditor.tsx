import { useEffect, useRef } from 'react'
import { autocompletion } from '@codemirror/autocomplete'
import { basicSetup } from 'codemirror'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { Cassandra, sql } from '@codemirror/lang-sql'
import { oneTheme, tokenTheme } from '../lib/editorTheme'
import { createCompletionSource, keyMarkerOption } from '../lib/cqlCompletion'

export interface SqlEditorProps {
  /** Initial document text. The editor is uncontrolled after mount. */
  initialValue: string
  /** Called with 1-based line and column whenever the cursor moves. */
  onCursor?: (line: number, col: number) => void
  /** Called with the full text after every edit. */
  onChange?: (text: string) => void
  /** Called on Mod-Enter (`all` false) or Shift-Mod-Enter (`all` true) with the text and the cursor's UTF-16 index. */
  onRun?: (run: { all: boolean; text: string; pos: number }) => void
  /** Called on Mod-s. */
  onSave?: () => void
  /** Called on Shift-Mod-s. */
  onSaveAs?: () => void
  /** Profile whose schema drives completion. Without one, only keywords are offered. */
  profile?: string
  /** Current keyspace, which unqualified table names resolve in. */
  keyspace?: string
  'aria-label'?: string
}

/**
 * CodeMirror 6 editor with the Cassandra SQL dialect and One-theme highlighting driven by CSS
 * variables, so it follows the light/dark theme without reconfiguration. Completion comes from the
 * Mod-s and Shift-Mod-s call `onSave` and `onSaveAs`. Completion comes from the
 * server's schema-aware engine (debounced and cancellable) and falls back to keywords on failure;
 * `profile` and `keyspace` are read at request time, so changing them does not recreate the editor.
 */
export function SqlEditor({ initialValue, onCursor, onChange, onRun, onSave, onSaveAs, profile, keyspace, ...rest }: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(onCursor)
  const changeCb = useRef(onChange)
  const runCb = useRef(onRun)
  const saveCb = useRef(onSave)
  const saveAsCb = useRef(onSaveAs)
  const profileRef = useRef(profile)
  const keyspaceRef = useRef(keyspace)
  useEffect(() => {
    profileRef.current = profile
    keyspaceRef.current = keyspace
    cb.current = onCursor
    changeCb.current = onChange
    runCb.current = onRun
    saveCb.current = onSave
    saveAsCb.current = onSaveAs
  })

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: 'Mod-Enter', run: (v) => (runCb.current?.({ all: false, text: v.state.doc.toString(), pos: v.state.selection.main.head }), true) },
              { key: 'Mod-s', run: () => (saveCb.current?.(), true) },
              { key: 'Shift-Mod-s', run: () => (saveAsCb.current?.(), true) },
              { key: 'Shift-Mod-Enter', run: (v) => (runCb.current?.({ all: true, text: v.state.doc.toString(), pos: v.state.selection.main.head }), true) },
            ]),
          ),
          basicSetup,
          sql({ dialect: Cassandra }),
          autocompletion({
            override: [createCompletionSource({ profile: () => profileRef.current ?? '', keyspace: () => keyspaceRef.current ?? '' })],
            addToOptions: [keyMarkerOption],
          }),
          syntaxHighlighting(oneTheme),
          tokenTheme,
          EditorView.contentAttributes.of({ 'aria-label': rest['aria-label'] ?? 'CQL editor' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeCb.current?.(u.state.doc.toString())
            if (u.selectionSet || u.docChanged || u.focusChanged) {
              const pos = u.state.selection.main.head
              const line = u.state.doc.lineAt(pos)
              cb.current?.(line.number, pos - line.from + 1)
            }
          }),
        ],
      }),
    })
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" data-testid="sql-editor" />
}
