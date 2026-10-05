import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { java } from '@codemirror/lang-java'
import { oneTheme, tokenTheme } from '../lib/editorTheme'

export interface CodeEditorProps {
  /** Document text. Editable editors are uncontrolled after mount; a read-only one is rebuilt when this changes. */
  value: string
  /** Called with the full text after every edit. */
  onChange?: (text: string) => void
  /** Show the code without allowing edits. */
  readOnly?: boolean
  'aria-label'?: string
}

/**
 * CodeMirror 6 editor with Java highlighting and the shared One theme, used for UDF bodies. It can be
 * read-only (the Function tab) or editable (the function editor). The text is not completed or validated here.
 */
export function CodeEditor({ value, onChange, readOnly, ...rest }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const changeCb = useRef(onChange)
  useEffect(() => {
    changeCb.current = onChange
  })
  const label = rest['aria-label'] ?? 'Code'

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          java(),
          syntaxHighlighting(oneTheme),
          tokenTheme,
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeCb.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.destroy()
    // An editable editor keeps its own text after mount; only a read-only view follows `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly ? value : '', readOnly, label])

  return <div ref={host} className="min-h-[96px] overflow-hidden rounded-md border border-line2" data-testid="code-editor" />
}
