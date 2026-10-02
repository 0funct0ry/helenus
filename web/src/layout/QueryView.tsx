import { useState } from 'react'
import { Play, StepForward } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { SqlEditor } from './SqlEditor'
import { ResultsPanel } from './ResultsPanel'
import { CONSISTENCY_LEVELS } from './TableView'
import { sampleQuery } from '../mocks/rows'
import { useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

/**
 * Query tab body: a toolbar (Run, Run all, consistency, page size, Allow filtering, Trace, keyspace),
 * a CodeMirror editor, and the Results/Trace/Messages panel below. The editor starts with the tab's
 * `initialCql` (set by "New query here") or a sample statement; the keyspace picker lists the
 * connected profile's real keyspaces. Run buttons are inert until execution lands in a later milestone.
 */
export function QueryView({ tab }: { tab?: WorkspaceTab }) {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces = [] } = useSchema(profileId, connected)
  const consistency = useWorkspace((s) => s.consistency)
  const setConsistency = useWorkspace((s) => s.setConsistency)
  const setCursor = useWorkspace((s) => s.setCursor)
  const [pageSize, setPageSize] = useState('100')
  const [filtering, setFiltering] = useState(false)
  const [trace, setTrace] = useState(true)
  const [ks, setKs] = useState(tab?.keyspace ?? '')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1 border-b border-line2 px-2.5 py-[5px]">
        <Button variant="primary" icon={<Play size={14} fill="currentColor" />} kbd="⌘↵" title="Execution arrives in a later milestone">
          Run
        </Button>
        <Button icon={<StepForward size={14} fill="currentColor" />} title="Execution arrives in a later milestone">
          Run all
        </Button>
        <div className="mx-1.5 h-4 w-px bg-line" />
        <Select label="Consistency" value={consistency} onChange={setConsistency} options={CONSISTENCY_LEVELS} />
        <Select label="Page size" value={pageSize} onChange={setPageSize} options={['50', '100', '500', '1000'].map((v) => ({ value: v, label: v }))} />
        <Toggle checked={filtering} onChange={setFiltering}>
          Allow filtering
        </Toggle>
        <Toggle checked={trace} onChange={setTrace}>
          Trace
        </Toggle>
        <div className="flex-1" />
        <Select label="Keyspace" mono value={ks} onChange={setKs} options={[...new Set([...(ks ? [ks] : []), ...keyspaces.filter((k) => !k.system).map((k) => k.name)])].map((n) => ({ value: n, label: n }))} />
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(160px,54%)_1px_1fr]">
        <div className="min-h-0 py-2">
          <SqlEditor initialValue={tab?.initialCql ?? sampleQuery} onCursor={setCursor} />
        </div>
        <div role="separator" aria-orientation="horizontal" className="bg-line" />
        <ResultsPanel />
      </div>
    </div>
  )
}
