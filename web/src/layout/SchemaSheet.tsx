import { useState } from 'react'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { ColumnRow } from './ColumnRow'
import { TableActionDialog } from './TableActionDialog'
import { RenameColumnDialog } from './RenameColumnDialog'
import { TableOptionsPanel } from './TableOptionsPanel'
import { newColumn } from '../lib/tableDraft'
import { toTypeDesc } from '../lib/typeBuilder'
import type { AlterTableOptions } from '../api/types'
import type { Column, Index } from '../lib/schemaModel'

/** What the Schema sub-view needs to offer edits on a table. */
export interface SchemaEditProps {
  keyspace: string
  table: string
  /** UDT names of the keyspace, offered by the type picker of the Add column row. */
  udts: string[]
  serverMajor: number
  /** Called after any change was applied, so the caller can refresh the schema. */
  onChanged: () => void
}

export interface SchemaSheetProps {
  columns: Column[]
  options?: Record<string, string>
  indexes?: Index[]
  /** Turns on edit mode: column actions, an Add column row and an Options panel. */
  edit?: SchemaEditProps
}

type Pending = { kind: 'drop'; column: string } | { kind: 'rename'; column: string } | { kind: 'add' } | { kind: 'options'; alter: AlterTableOptions }

/**
 * The Schema sub-view: primary key layout, column table, table options and indexes. With `edit` set it
 * also shows Rename (key columns) and Drop (other columns) per row, an Add column row, a disabled
 * "change type" control and the Options panel; each action opens a confirm dialog with the CQL preview.
 */
export function SchemaSheet({ columns, options = {}, indexes = [], edit }: SchemaSheetProps) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [draft, setDraft] = useState(() => newColumn())
  const close = () => setPending(null)
  const applied = () => {
    setDraft(newColumn())
    edit?.onChanged()
  }
  const pk = columns.filter((c) => c.kind === 'partition')
  const ck = columns.filter((c) => c.kind === 'clustering')
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px]">
        <h3 className="mb-2 mt-0 text-[13px] font-semibold">Primary key</h3>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line2 bg-surface px-3 py-2.5 font-mono text-[12.5px]">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-xs text-muted">Partition key</span>
            {pk.map((c) => (
              <span key={c.name} className="flex items-center gap-1.5">
                <KeyMarker kind="partition" position={c.position} />
                {c.name}
              </span>
            ))}
          </div>
          {ck.length > 0 && (
            <>
              <div className="h-4 w-px bg-line" />
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-xs text-muted">Clustering</span>
                {ck.map((c) => (
                  <span key={c.name} className="flex items-center gap-1.5">
                    <KeyMarker kind="clustering" position={c.position} order={c.order} />
                    {c.name}
                    <span className="font-sans text-xs text-muted">{c.order}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Columns</h3>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {['Key', 'Name', 'Type', ...(edit ? ['Actions'] : [])].map((h) => (
                <th key={h} className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.name}>
                <td className="w-24 border-b border-line2 px-2.5 py-1.5">
                  <KeyMarker kind={c.kind} position={c.position} order={c.order} />
                </td>
                <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{c.name}</td>
                <td className="border-b border-line2 px-2.5 py-1.5">
                  <TypeBadge type={c.type} />
                </td>
                {edit && (
                  <td className="border-b border-line2 px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {c.kind === 'partition' || c.kind === 'clustering' ? (
                        <Button variant="ghost" aria-label={`Rename ${c.name}`} onClick={() => setPending({ kind: 'rename', column: c.name })}>
                          Rename
                        </Button>
                      ) : (
                        <Button variant="ghost" aria-label={`Drop ${c.name}`} onClick={() => setPending({ kind: 'drop', column: c.name })}>
                          Drop
                        </Button>
                      )}
                      <Tooltip content="Cassandra does not support changing a column's type">
                        <span>
                          <Button variant="ghost" disabled aria-label={`Change type of ${c.name}`}>
                            Change type
                          </Button>
                        </span>
                      </Tooltip>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {edit && (
          <ul className="m-0 mt-2 list-none p-0">
            <ColumnRow column={draft} index={0} count={1} udts={edit.udts} onChange={setDraft} onRemove={() => undefined} onMove={() => undefined} />
            <li className="py-2">
              <Button disabled={draft.name.trim() === ''} onClick={() => setPending({ kind: 'add' })}>
                Add column…
              </Button>
            </li>
          </ul>
        )}
        {edit && (
          <>
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Edit options</h3>
            <TableOptionsPanel options={options} serverMajor={edit.serverMajor} onReview={(alter) => setPending({ kind: 'options', alter })} />
          </>
        )}
        {edit && pending?.kind === 'drop' && (
          <TableActionDialog
            title="Drop column"
            subtitle={`${edit.keyspace}.${edit.table}.${pending.column}`}
            request={{ action: 'drop_column', keyspace: edit.keyspace, name: edit.table, column: { name: pending.column } }}
            applyLabel="Drop column"
            danger
            onApplied={applied}
            onClose={close}
          />
        )}
        {edit && pending?.kind === 'rename' && (
          <RenameColumnDialog keyspace={edit.keyspace} table={edit.table} column={pending.column} onRenamed={applied} onClose={close} />
        )}
        {edit && pending?.kind === 'add' && (
          <TableActionDialog
            title="Add column"
            subtitle={`${edit.keyspace}.${edit.table}`}
            request={{ action: 'add_column', keyspace: edit.keyspace, name: edit.table, column: { name: draft.name, type: toTypeDesc(draft.type, edit.keyspace), static: draft.static } }}
            applyLabel="Add column"
            onApplied={applied}
            onClose={close}
          />
        )}
        {edit && pending?.kind === 'options' && (
          <TableActionDialog
            title="Change options"
            subtitle={`${edit.keyspace}.${edit.table}`}
            request={{ action: 'options', keyspace: edit.keyspace, name: edit.table, alter: pending.alter }}
            applyLabel="Apply changes"
            onApplied={applied}
            onClose={close}
          />
        )}

        {Object.keys(options).length > 0 && (
          <>
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Table options</h3>
            <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-px overflow-hidden rounded-md border border-line2 bg-line2">
              {Object.entries(options).map(([k, v]) => (
                <div key={k} className="bg-editor px-3 py-2">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="m-0 break-words font-mono text-xs">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {indexes.length > 0 && (
          <>
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Indexes</h3>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Name', 'Column', 'Kind'].map((h) => (
                    <th key={h} className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {indexes.map((i) => (
                  <tr key={i.name}>
                    <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{i.name}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{i.column}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5">{i.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
