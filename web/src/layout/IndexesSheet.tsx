import { useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { NewIndexDialog } from './NewIndexDialog'
import { DropIndexDialog } from './DropIndexDialog'
import type { Index, Table } from '../lib/schemaModel'

export interface IndexesSheetProps {
  table: Table
  serverMajor: number
  /** Hide the New index and Drop actions (system keyspaces). */
  readOnly?: boolean
  /** Called after an index was created or dropped, so the schema can refresh. */
  onChanged: () => void
}

function targetName(i: Index): string {
  const t = i.target ?? ''
  return t.includes('(') ? t.split('(')[0].toUpperCase() : 'plain'
}

function optionsText(i: Index): string {
  return Object.entries(i.options ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')
}

/**
 * The Indexes sub-view: name, column, target, kind badge (SAI, 2i or custom) and options of every index on
 * the table. "New index" opens NewIndexDialog; Drop asks for a plain confirmation. Custom indexes are
 * listed read-only because Helenus cannot plan them.
 */
export function IndexesSheet({ table, serverMajor, readOnly, onChanged }: IndexesSheetProps) {
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px]">
        <div className="mb-2 flex items-center">
          <h3 className="m-0 flex-1 text-[13px] font-semibold">Indexes on this table</h3>
          {!readOnly && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={13} aria-hidden /> New index
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-danger">
            {error}
          </p>
        )}
        {table.indexes.length === 0 ? (
          <p className="text-muted">This table has no indexes.</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Name', 'Column', 'Target', 'Kind', 'Options', ''].map((h) => (
                  <th key={h} className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.indexes.map((i) => (
                <tr key={i.name}>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono">
                    <Search size={12} className="mr-1 inline text-muted" aria-hidden />
                    {i.name}
                  </td>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{i.column}</td>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono text-muted">{targetName(i)}</td>
                  <td className="border-b border-line2 px-2.5 py-1.5">
                    <Badge title={i.kind}>{i.badge ?? '2i'}</Badge>
                  </td>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono text-muted">{optionsText(i)}</td>
                  <td className="border-b border-line2 px-2.5 py-1.5 text-right">
                    {!readOnly && i.badge !== 'custom' && (
                      <Button variant="ghost" aria-label={`Drop ${i.name}`} onClick={() => setDropping(i.name)}>
                        <Trash2 size={13} aria-hidden /> Drop
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && <NewIndexDialog table={table} serverMajor={serverMajor} onCreated={onChanged} onClose={() => setCreating(false)} />}
      {dropping && <DropIndexDialog keyspace={table.keyspace} index={dropping} onDropped={() => { setError(null); onChanged() }} onError={setError} onClose={() => setDropping(null)} />}
    </div>
  )
}
