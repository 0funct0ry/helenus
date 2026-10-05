import { useState } from 'react'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { TypeBadge } from '../ui/TypeBadge'
import { AggregateBuilder } from './AggregateBuilder'
import { AggregateTestPanel } from './AggregateTestPanel'
import { DependencyPanel } from './DependencyPanel'
import { DropAggregateDialog } from './DropAggregateDialog'
import { useDdl, useRefreshSchema, useSchema } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import { useToasts } from '../store/toast'
import type { WorkspaceTab } from '../store/workspace'

export interface AggregateViewProps {
  tab: WorkspaceTab
}

/**
 * Aggregate tab body for one overload (the tab's object is its signature): argument types, state function, state
 * type, final function, initial condition, a Test panel, dependencies and DDL. "Edit" opens the builder in replace
 * mode and "Drop aggregate…" the confirmation dialog; system keyspaces offer neither.
 */
export function AggregateView({ tab }: AggregateViewProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const close = useWorkspace((s) => s.close)
  const { data: keyspaces } = useSchema(profileId, connected)
  const refresh = useRefreshSchema(profileId)
  const pushToast = useToasts((s) => s.push)
  const ks = keyspaces?.find((k) => k.name === tab.keyspace)
  const agg = ks?.aggregates.find((a) => a.signature === tab.object)
  const [dialog, setDialog] = useState<'edit' | 'drop' | null>(null)
  const { data: described } = useDdl(profileId, tab.keyspace, 'aggregate', tab.object, !!agg)
  if (!agg || !ks) return <p className="p-6 text-muted">Aggregate not found.</p>
  const ddl = (described ?? '').trim()
  const rows: [string, React.ReactNode][] = [
    ['arguments', agg.argTypes.length ? agg.argTypes.map((t, i) => <TypeBadge key={i} type={t} />) : 'none'],
    ['state function', <span className="font-mono">{agg.stateFunc}</span>],
    ['state type', <TypeBadge type={agg.stateType} />],
    ['final function', agg.finalFunc ? <span className="font-mono">{agg.finalFunc}</span> : <span className="text-muted">none</span>],
    ['initial condition', agg.initCond ? <span className="font-mono">{agg.initCond}</span> : <span className="text-muted">none (state starts as null)</span>],
    ['returns', <TypeBadge type={agg.returnType} />],
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line2 px-2.5 py-[5px]">
        <span className="font-medium">
          {agg.keyspace}.{agg.signature}
        </span>
        <Badge tone="udt">aggregate</Badge>
        <div className="flex-1" />
        <Button variant="ghost" icon={<Copy size={14} />} disabled={!ddl} onClick={() => void navigator.clipboard?.writeText(ddl)}>
          Copy DDL
        </Button>
        {!ks.system && (
          <>
            <Button icon={<Pencil size={14} />} onClick={() => setDialog('edit')}>
              Edit
            </Button>
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setDialog('drop')}>
              Drop aggregate…
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px] md:grid md:grid-cols-[1.3fr_1fr] md:gap-7">
          <div>
            <h3 className="mb-2 mt-0 text-[13px] font-semibold">Definition</h3>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td className="w-40 border-b border-line2 px-2.5 py-1.5 text-muted">{label}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5">
                      <span className="inline-flex flex-wrap items-center gap-1.5">{value}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ddl && (
              <>
                <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">DDL</h3>
                <pre className="m-0 whitespace-pre-wrap rounded-md border border-line2 bg-editor p-3.5 font-mono text-[12.5px] leading-5">{ddl}</pre>
              </>
            )}
          </div>
          <div>
            <h3 className="mb-2 mt-0 text-[13px] font-semibold max-md:mt-[22px]">Test</h3>
            <AggregateTestPanel key={agg.signature} aggregate={agg} keyspace={ks} />
          </div>
          <div className="md:col-span-2">
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Dependencies</h3>
            <DependencyPanel kind="aggregate" keyspace={agg.keyspace} name={agg.name} signature={agg.signature} />
          </div>
        </div>
      </div>
      {dialog === 'edit' && (
        <AggregateBuilder
          keyspace={agg.keyspace}
          existing={agg}
          onSaved={() => {
            refresh.mutate()
            pushToast(`Aggregate ${agg.name} changed`)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'drop' && (
        <DropAggregateDialog
          aggregate={agg}
          onClose={() => setDialog(null)}
          onDropped={() => {
            setDialog(null)
            refresh.mutate()
            pushToast(`Aggregate ${agg.name} dropped`)
            close(tab.id)
          }}
        />
      )}
    </div>
  )
}
