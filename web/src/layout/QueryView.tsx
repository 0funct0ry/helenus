import { useMemo, useState } from 'react'
import { Play, Square, StepForward } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { SqlEditor } from './SqlEditor'
import { ResultsPanel } from './ResultsPanel'
import { CONSISTENCY_LEVELS } from './TableView'
import { useSchema } from '../api/hooks'
import { useQueryTab } from '../api/useQueryTab'
import { textHasIf, textHasRead } from '../lib/statements'
import { newQueryState, useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

const SERIAL = ['SERIAL', 'LOCAL_SERIAL'].map((v) => ({ value: v, label: v }))
const PAGE_SIZES = ['50', '100', '500', '1000'].map((v) => ({ value: v, label: v }))

/**
 * Query tab body: a toolbar (Run, Run all, Cancel, consistency, serial consistency for statements with
 * IF, page size, Allow filtering, Trace, keyspace), a CodeMirror editor and the results panel. All state
 * lives in the workspace store keyed by tab id. Cmd+Enter runs the statement under the cursor and
 * Shift+Cmd+Enter runs every statement. `ANY` consistency is disabled while the text contains a read.
 */
export function QueryView({ tab }: { tab?: WorkspaceTab }) {
  const id = tab?.id ?? 'adhoc'
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces = [] } = useSchema(profileId, connected)
  const globalConsistency = useWorkspace((s) => s.consistency)
  const setGlobalConsistency = useWorkspace((s) => s.setConsistency)
  const setCursor = useWorkspace((s) => s.setCursor)
  const cursor = useWorkspace((s) => s.cursor)
  const patch = useWorkspace((s) => s.patchQuery)
  const stored = useWorkspace((s) => s.queryStates[id])
  const st = useMemo(() => stored ?? newQueryState({ keyspace: tab?.keyspace ?? '', ...(tab?.initialCql !== undefined && { text: tab.initialCql }) }, globalConsistency), [stored, tab, globalConsistency])
  const [initialText] = useState(st.text)
  const q = useQueryTab(id)
  const reads = textHasRead(st.text)
  const lwt = textHasIf(st.text)
  const ksOptions = [...new Set([...(st.keyspace ? [st.keyspace] : []), ...keyspaces.filter((k) => !k.system).map((k) => k.name)])].map((n) => ({ value: n, label: n }))
  const levels = CONSISTENCY_LEVELS.map((o) => (o.value === 'ANY' && reads ? { ...o, disabled: true, title: 'ANY is only valid for writes; reads need ONE or higher' } : o))

  /** UTF-16 index of the status-bar cursor (1-based line/col) in the stored text. */
  const cursorIndex = () => {
    const lines = st.text.split('\n')
    let idx = 0
    for (let i = 0; i < Math.min(cursor.line - 1, lines.length); i++) idx += lines[i].length + 1
    return Math.min(idx + cursor.col - 1, st.text.length)
  }

  const onRun = ({ all, text, pos }: { all: boolean; text: string; pos: number }) => {
    if (st.running) return
    void (all ? q.runAll(text) : q.runOne(text, pos))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1 border-b border-line2 px-2.5 py-[5px]">
        <Button variant="primary" icon={<Play size={14} fill="currentColor" />} kbd="⌘↵" disabled={st.running || !connected} onClick={() => onRun({ all: false, text: st.text, pos: cursorIndex() })}>
          Run
        </Button>
        <Button icon={<StepForward size={14} fill="currentColor" />} disabled={st.running || !connected} onClick={() => onRun({ all: true, text: st.text, pos: 0 })}>
          Run all
        </Button>
        {st.running && (
          <Button variant="danger" icon={<Square size={12} fill="currentColor" />} onClick={q.cancel}>
            Cancel
          </Button>
        )}
        <div className="mx-1.5 h-4 w-px bg-line" />
        <Select
          label="Consistency"
          value={st.consistency}
          onChange={(v) => {
            patch(id, { consistency: v })
            setGlobalConsistency(v)
          }}
          options={levels}
        />
        {lwt && <Select label="Serial" value={st.serial} onChange={(v) => patch(id, { serial: v })} options={SERIAL} />}
        <Select label="Page size" value={String(st.pageSize)} onChange={(v) => patch(id, { pageSize: Number(v) })} options={PAGE_SIZES} />
        <Toggle checked={st.allowFiltering} onChange={(v) => patch(id, { allowFiltering: v })}>
          Allow filtering
        </Toggle>
        <Toggle checked={st.trace} onChange={(v) => patch(id, { trace: v })}>
          Trace
        </Toggle>
        <div className="flex-1" />
        <Select label="Keyspace" mono value={st.keyspace} onChange={(v) => patch(id, { keyspace: v })} options={ksOptions} />
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(160px,54%)_1px_1fr]">
        <div className="min-h-0 py-2">
          <SqlEditor initialValue={initialText} profile={connected ? profileId : ''} keyspace={st.keyspace} onCursor={setCursor} onChange={(text) => patch(id, { text })} onRun={onRun} />
        </div>
        <div role="separator" aria-orientation="horizontal" className="bg-line" />
        <ResultsPanel
          results={st.results}
          active={st.activeResult}
          onActive={(i) => patch(id, { activeResult: i })}
          consistency={st.consistency}
          onPage={(i, d) => void q.page(i, d)}
          onRunWithFiltering={(i) => void q.runWithFiltering(i)}
          onCount={q.count}
        />
      </div>
    </div>
  )
}
