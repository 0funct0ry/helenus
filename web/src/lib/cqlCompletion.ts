import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import { Cassandra, keywordCompletionSource } from '@codemirror/lang-sql'
import { fetchCompletions } from '../api/complete'
import type { CompleteItem, CompleteKind, CompleteRequest, CompleteResponse } from '../api/types'

/** Debounce between the last keystroke and the request (SPEC §10). */
export const COMPLETION_DEBOUNCE_MS = 60

/** CodeMirror icon type for each candidate kind. The icons match the schema tree's vocabulary. */
const TYPE_FOR_KIND: Record<CompleteKind, string> = {
  keyword: 'keyword',
  keyspace: 'namespace',
  table: 'class',
  view: 'interface',
  column: 'property',
  function: 'function',
  type: 'type',
  command: 'method',
}

/** A CodeMirror completion that remembers the key marker data of the candidate it came from. */
export interface CqlCompletion extends Completion {
  key?: CompleteItem['key']
  position?: number
  order?: CompleteItem['order']
}

/** Convert a server candidate. The insert text is both the label and the applied text, so a quoted
 * identifier such as `"Orders"` reads exactly as it will be inserted. */
export function toCompletion(item: CompleteItem): CqlCompletion {
  return {
    label: item.insert,
    displayLabel: item.label,
    type: TYPE_FOR_KIND[item.kind] ?? 'text',
    detail: item.detail,
    key: item.key,
    position: item.position,
    order: item.order,
  }
}

/** The key marker text for a column candidate: `PK1`, `CK2↓`, `S`, or null for a regular column. */
export function keyMarkerText(c: CqlCompletion): string | null {
  switch (c.key) {
    case 'partition':
      return `PK${c.position ?? ''}`
    case 'clustering':
      return `CK${c.position ?? ''}${c.order === 'DESC' ? '↓' : '↑'}`
    case 'static':
      return 'S'
    default:
      return null
  }
}

/** `addToOptions` entry that draws the key marker before the label of key columns. */
export const keyMarkerOption = {
  position: 15,
  render(completion: Completion): Node | null {
    const text = keyMarkerText(completion as CqlCompletion)
    if (!text) return null
    const el = document.createElement('span')
    el.className = 'cm-completionKey'
    el.textContent = text
    el.style.cssText = 'margin-left:6px;font-size:10px;opacity:.75'
    return el
  },
}

export interface CompletionSourceOptions {
  /** The profile to complete against; an empty name disables server completion. */
  profile: () => string
  /** The editor's current keyspace, which unqualified names resolve in. */
  keyspace: () => string
  delayMs?: number
  /** Replaceable in tests. */
  fetcher?: (profile: string, body: CompleteRequest, signal?: AbortSignal) => Promise<CompleteResponse>
}

/**
 * Build a CodeMirror completion source backed by `POST /p/{profile}/complete`. Requests wait
 * {@link COMPLETION_DEBOUNCE_MS} after the last keystroke, and starting a new one aborts the one in
 * flight, so typing never queues work. Any failure falls back to keyword completion, which needs
 * no server.
 */
export function createCompletionSource(opts: CompletionSourceOptions): CompletionSource {
  const delay = opts.delayMs ?? COMPLETION_DEBOUNCE_MS
  const fetcher = opts.fetcher ?? fetchCompletions
  const keywords = keywordCompletionSource(Cassandra, true)
  let inflight: AbortController | null = null

  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    inflight?.abort()
    const ac = new AbortController()
    inflight = ac
    ctx.addEventListener('abort', () => ac.abort())

    const profile = opts.profile()
    if (!profile) return keywords(ctx) as CompletionResult | null

    if (!ctx.explicit) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay)
        ac.signal.addEventListener('abort', () => {
          clearTimeout(t)
          resolve()
        })
      })
    }
    if (ac.signal.aborted) return null

    try {
      const res = await fetcher(profile, { text: ctx.state.doc.toString(), cursor: ctx.pos, keyspace: opts.keyspace() }, ac.signal)
      if (ac.signal.aborted) return null
      if (res.items.length === 0) return null
      return { from: res.from, options: res.items.map(toCompletion), filter: false }
    } catch {
      if (ac.signal.aborted) return null
      return keywords(ctx) as CompletionResult | null
    } finally {
      if (inflight === ac) inflight = null
    }
  }
}
