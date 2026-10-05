import { useState } from 'react'
import { Copy, Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { TypeBadge } from '../ui/TypeBadge'
import { AlterFieldDialog } from './AlterFieldDialog'
import { DropTypeDialog } from './DropTypeDialog'
import { DependencyPanel } from './DependencyPanel'
import { useDdl, useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

export interface TypeViewProps {
  tab: WorkspaceTab
}

/**
 * Type tab body: a UDT inspector listing fields, what uses the type and its DDL, with the actions Cassandra
 * supports: add a field, rename a field and drop the type. Each opens a dialog that previews the statement.
 * Changing a field's type is not offered because Cassandra does not support it.
 */
export function TypeView({ tab }: TypeViewProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces } = useSchema(profileId, connected)
  const udt = keyspaces?.find((k) => k.name === tab.keyspace)?.types.find((t) => t.name === tab.object)
  const close = useWorkspace((s) => s.close)
  const [dialog, setDialog] = useState<{ kind: 'add' } | { kind: 'rename'; field: string } | { kind: 'drop' } | null>(null)
  const { data: described } = useDdl(profileId, tab.keyspace, 'type', tab.object, !!udt)
  if (!udt) return <p className="p-6 text-muted">Type not found.</p>
  const ddl = (described ?? `CREATE TYPE ${udt.keyspace}.${udt.name} (\n${udt.fields.map((f) => `    ${f.name} ${f.type}`).join(',\n')}\n);`).trim()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line2 px-2.5 py-[5px]">
        <span className="font-medium">
          {udt.keyspace}.{udt.name}
        </span>
        <Badge tone="udt">user-defined type</Badge>
        <div className="flex-1" />
        <Button variant="ghost" icon={<Copy size={14} />} onClick={() => void navigator.clipboard?.writeText(ddl)}>
          Copy DDL
        </Button>
        <Button icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'add' })}>
          Add field
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          disabled={udt.usedBy.length > 0}
          title={udt.usedBy.length ? `In use by ${udt.usedBy.length} ${udt.usedBy.length === 1 ? 'object' : 'objects'}: ${udt.usedBy.join(', ')}` : undefined}
          onClick={() => setDialog({ kind: 'drop' })}
        >
          Drop type
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px] md:grid md:grid-cols-[1.3fr_1fr] md:gap-7">
          <div>
            <h3 className="mb-2 mt-0 text-[13px] font-semibold">Fields</h3>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">Name</th>
                  <th className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">Type</th>
                  <th className="w-8 border-b border-line bg-surface" />
                </tr>
              </thead>
              <tbody>
                {udt.fields.map((f) => (
                  <tr key={f.name}>
                    <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{f.name}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5">
                      <TypeBadge type={f.type} />
                    </td>
                    <td className="border-b border-line2 px-1">
                      <IconButton label={`Rename field ${f.name}`} icon={<Pencil size={13} />} onClick={() => setDialog({ kind: 'rename', field: f.name })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2.5 flex gap-2 rounded-md bg-surface px-2.5 py-2 text-[12.5px] text-muted">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
              Cassandra lets you add and rename fields. Changing a field's type is not supported.
            </div>
          </div>
          <div>
            <h3 className="mb-2 mt-0 text-[13px] font-semibold max-md:mt-[22px]">Used by</h3>
            {udt.usedBy.length === 0 ? (
              <p className="m-0 text-muted">Not used by any column.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-[12.5px]">
                {udt.usedBy.map((u) => (
                  <li key={u} className="text-accent">
                    {u}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">DDL</h3>
            <pre className="m-0 whitespace-pre-wrap rounded-md border border-line2 bg-editor p-3.5 font-mono text-[12.5px] leading-5">{ddl}</pre>
          </div>
          <div className="md:col-span-2">
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Dependencies</h3>
            <DependencyPanel kind="type" keyspace={udt.keyspace} name={udt.name} />
          </div>
        </div>
      </div>
      {dialog?.kind === 'add' && <AlterFieldDialog keyspace={udt.keyspace} type={udt.name} mode="add" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && <AlterFieldDialog keyspace={udt.keyspace} type={udt.name} mode="rename" field={dialog.field} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'drop' && (
        <DropTypeDialog
          keyspace={udt.keyspace}
          type={udt.name}
          onClose={() => setDialog(null)}
          onDropped={() => {
            setDialog(null)
            close(tab.id)
          }}
        />
      )}
    </div>
  )
}
