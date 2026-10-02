import { Copy, Info, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { TypeBadge } from '../ui/TypeBadge'
import { useDdl, useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

export interface TypeViewProps {
  tab: WorkspaceTab
}

/** Type tab body: a read-only UDT inspector listing fields, the columns that use the type, and its DDL. */
export function TypeView({ tab }: TypeViewProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces } = useSchema(profileId, connected)
  const udt = keyspaces?.find((k) => k.name === tab.keyspace)?.types.find((t) => t.name === tab.object)
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
        <Button variant="danger" icon={<Trash2 size={14} />} disabled title={udt.usedBy.length ? `In use by ${udt.usedBy.length} columns` : 'Editing arrives in a later milestone'}>
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
                </tr>
              </thead>
              <tbody>
                {udt.fields.map((f) => (
                  <tr key={f.name}>
                    <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{f.name}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5">
                      <TypeBadge type={f.type} />
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
        </div>
      </div>
    </div>
  )
}
