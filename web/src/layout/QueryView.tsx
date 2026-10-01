import { useState } from 'react'
import { Play, StepForward } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { SqlEditor } from './SqlEditor'
import { ResultsPanel } from './ResultsPanel'
import { CONSISTENCY_LEVELS } from './TableView'
import { sampleQuery } from '../mocks/rows'
import { keyspaces } from '../mocks/schema'
import { useWorkspace } from '../store/workspace'

/**
 * Query tab body: a toolbar (Run, Run all, consistency, page size, Allow filtering, Trace, keyspace),
 * a CodeMirror editor holding static mock CQL, and the Results/Trace/Messages panel below.
 * Run buttons are inert until execution lands in a later milestone.
 */
export function QueryView() {
  const consistency = useWorkspace((s) => s.consistency)
  const setConsistency = useWorkspace((s) => s.setConsistency)
  const setCursor = useWorkspace((s) => s.setCursor)
  const [pageSize, setPageSize] = useState('100')
  const [filtering, setFiltering] = useState(false)
  const [trace, setTrace] = useState(true)
  const [ks, setKs] = useState('payments')
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
        <Select label="Keyspace" mono value={ks} onChange={setKs} options={keyspaces.filter((k) => !k.system).map((k) => ({ value: k.name, label: k.name }))} />
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(160px,54%)_1px_1fr]">
        <div className="min-h-0 py-2">
          <SqlEditor initialValue={sampleQuery} onCursor={setCursor} />
        </div>
        <div role="separator" aria-orientation="horizontal" className="bg-line" />
        <ResultsPanel />
      </div>
    </div>
  )
}
