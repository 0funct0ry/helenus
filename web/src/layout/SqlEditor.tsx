import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Cassandra, sql } from '@codemirror/lang-sql'
import { tags as t } from '@lezer/highlight'

const oneTheme = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword], color: 'var(--syn-kw)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-str)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-num)' },
  { tag: [t.typeName, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.function(t.variableName), t.standard(t.name)], color: 'var(--syn-fn)' },
  { tag: [t.lineComment, t.blockComment], color: 'var(--syn-com)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.operator, t.paren, t.separator], color: 'var(--syn-punct)' },
  { tag: [t.atom, t.constant(t.name)], color: 'var(--syn-const)' },
])

// CodeMirror's built-in base theme styles the gutters light and out-specifies plain CSS, so the
// token-driven colours are applied through a theme extension (which sorts after the base theme).
const tokenTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg-editor)', color: 'var(--text)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-editor)',
    color: 'var(--text-disabled)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text)' },
})

export interface SqlEditorProps {
  /** Initial document text. The editor is uncontrolled after mount. */
  initialValue: string
  /** Called with 1-based line and column whenever the cursor moves. */
  onCursor?: (line: number, col: number) => void
  /** Called with the full text after every edit. */
  onChange?: (text: string) => void
  /** Called on Mod-Enter (`all` false) or Shift-Mod-Enter (`all` true) with the text and the cursor's UTF-16 index. */
  onRun?: (run: { all: boolean; text: string; pos: number }) => void
  'aria-label'?: string
}

/**
 * CodeMirror 6 editor with the Cassandra SQL dialect and One-theme highlighting driven by CSS
 * variables, so it follows the light/dark theme without reconfiguration.
 */
export function SqlEditor({ initialValue, onCursor, onChange, onRun, ...rest }: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(onCursor)
  const changeCb = useRef(onChange)
  const runCb = useRef(onRun)
  useEffect(() => {
    cb.current = onCursor
    changeCb.current = onChange
    runCb.current = onRun
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
              { key: 'Shift-Mod-Enter', run: (v) => (runCb.current?.({ all: true, text: v.state.doc.toString(), pos: v.state.selection.main.head }), true) },
            ]),
          ),
          basicSetup,
          sql({ dialect: Cassandra }),
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
