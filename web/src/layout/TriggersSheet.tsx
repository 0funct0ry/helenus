import { useState } from 'react'
import { Plus, Trash2, Zap } from 'lucide-react'
import { Button } from '../ui/Button'
import { NewTriggerDialog } from './NewTriggerDialog'
import { DropTriggerDialog } from './DropTriggerDialog'
import type { Table } from '../lib/schemaModel'

export interface TriggersSheetProps {
  table: Table
  /** Hide the New trigger and Drop actions (system keyspaces). */
  readOnly?: boolean
  /** Called after a trigger was created or dropped, so the schema can refresh. */
  onChanged: () => void
}

/**
 * The Triggers sub-view: name and class of every trigger on the table. "New trigger" opens NewTriggerDialog;
 * Drop asks for confirmation. Not shown for Astra profiles, which do not support triggers.
 */
export function TriggersSheet({ table, readOnly, onChanged }: TriggersSheetProps) {
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const triggers = table.triggers ?? []
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px]">
        <div className="mb-2 flex items-center">
          <h3 className="m-0 flex-1 text-[13px] font-semibold">Triggers on this table</h3>
          {!readOnly && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={13} aria-hidden /> New trigger
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-danger">
            {error}
          </p>
        )}
        {triggers.length === 0 ? (
          <p className="text-muted">This table has no triggers.</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Name', 'Class', ''].map((h) => (
                  <th key={h} className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {triggers.map((t) => (
                <tr key={t.name}>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono">
                    <Zap size={12} className="mr-1 inline text-muted" aria-hidden />
                    {t.name}
                  </td>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono text-muted">{t.class}</td>
                  <td className="border-b border-line2 px-2.5 py-1.5 text-right">
                    {!readOnly && (
                      <Button variant="ghost" aria-label={`Drop ${t.name}`} onClick={() => setDropping(t.name)}>
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
      {creating && <NewTriggerDialog table={table} onCreated={() => { setError(null); onChanged() }} onClose={() => setCreating(false)} />}
      {dropping && (
        <DropTriggerDialog
          keyspace={table.keyspace}
          table={table.name}
          trigger={dropping}
          onDropped={() => { setError(null); onChanged() }}
          onError={setError}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}
