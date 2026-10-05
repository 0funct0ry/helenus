import { useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { TypeBadge } from '../ui/TypeBadge'
import { testAggregate } from '../api/testAggregate'
import { describeError } from '../api/client'
import { useWorkspace } from '../store/workspace'
import type { AggregateTestResult } from '../api/types'
import type { Agg, Keyspace } from '../lib/schemaModel'

export interface AggregateTestPanelProps {
  aggregate: Agg
  keyspace: Keyspace
}

const norm = (t: string) => t.replace(/frozen<(.*)>/g, '$1').replace(/\s+/g, '')

/**
 * Test panel of the Aggregate tab: pick a table (or view) of the keyspace and, for each argument, a column of the
 * matching type, then run `SELECT ks.agg(col, …) FROM ks.table LIMIT 1000` through the server. The row limit is
 * stated next to the Run button. Shows the result with the elapsed time, or the server's error.
 */
export function AggregateTestPanel({ aggregate, keyspace }: AggregateTestPanelProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const sources = [...keyspace.tables.map((t) => ({ name: t.name, columns: t.columns })), ...keyspace.views.map((v) => ({ name: v.name, columns: v.columns }))]
  const [table, setTable] = useState('')
  const [columns, setColumns] = useState<string[]>(() => aggregate.argTypes.map(() => ''))
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AggregateTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const source = sources.find((s) => s.name === table)
  const columnsFor = (type: string) => (source?.columns ?? []).filter((c) => norm(c.type) === norm(type))
  const ready = !!source && columns.every((c) => c !== '')

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await testAggregate(profileId, aggregate.keyspace, aggregate.name, aggregate.signature, table, columns))
    } catch (e) {
      setResult(null)
      setError(describeError(e))
    }
    setRunning(false)
  }

  return (
    <section aria-label="Test aggregate">
      <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
        <li className="grid items-center gap-2" style={{ gridTemplateColumns: '110px 1fr' }}>
          <span className="text-[12.5px] text-muted">Table</span>
          <Select
            aria-label="Test table"
            mono
            value={table}
            options={[{ value: '', label: 'Select a table…' }, ...sources.map((s) => ({ value: s.name, label: s.name }))]}
            onChange={(v) => {
              setTable(v)
              setColumns(aggregate.argTypes.map(() => ''))
            }}
          />
        </li>
        {aggregate.argTypes.map((t, i) => {
          const options = columnsFor(t)
          return (
            <li key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: '110px 1fr' }}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] text-muted">Argument {i + 1}</span>
                <TypeBadge type={t} />
              </span>
              <Select
                aria-label={`Column for argument ${i + 1}`}
                mono
                value={columns[i]}
                options={[{ value: '', label: options.length || !source ? 'Select a column…' : `No ${t} column in ${table}` }, ...options.map((c) => ({ value: c.name, label: c.name }))]}
                onChange={(v) => setColumns((cs) => cs.map((x, n) => (n === i ? v : x)))}
              />
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={<Play size={14} />} disabled={!ready || running} onClick={() => void run()}>
          Run
        </Button>
        <span className="text-xs text-muted">Reads at most 1000 rows (LIMIT 1000).</span>
      </div>
      {result && (
        <p aria-label="Aggregate result" className="mb-0 mt-3 font-mono text-[12.5px]">
          <span className="text-muted">result = </span>
          {result.value === null || result.value === undefined ? 'null' : typeof result.value === 'object' ? JSON.stringify(result.value) : String(result.value)}
          <span className="ml-2 text-muted">{result.elapsed_ms.toFixed(1)} ms</span>
        </p>
      )}
      {error && (
        <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
