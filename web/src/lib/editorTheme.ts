import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Shared CodeMirror theme: One-style highlighting and editor chrome driven by CSS variables, so it follows light/dark. */
export const oneTheme = HighlightStyle.define([
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
export const tokenTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg-editor)', color: 'var(--text)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-editor)',
    color: 'var(--text-disabled)',
    border: 'none',
  },
  // The selection layer is drawn behind the text, so the active-line background (almost opaque)
  // hid it on the cursor's line. Raise the layer above the content; the colour is translucent so
  // the text stays readable underneath.
  '.cm-selectionLayer': { zIndex: '100 !important' },
  '.cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
  '.cm-content ::selection': { backgroundColor: 'var(--selection)' },
  // Completion popup: follow the app theme instead of CodeMirror's light default.
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
  },
  '.cm-tooltip-autocomplete > ul > li': { color: 'var(--text)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--on-accent)',
  },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'italic' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': { color: 'var(--on-accent)' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
  '.cm-completionIcon': { opacity: '0.7' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text)' },
})
