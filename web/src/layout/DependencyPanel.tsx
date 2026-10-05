import { Braces, Database, Eye, FunctionSquare, Lock, Search, Sigma, Table2, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDeps } from '../api/hooks'
import { describeError } from '../api/client'
import type { DepItem } from '../api/types'
import { useWorkspace } from '../store/workspace'

export interface DependencyPanelProps {
  /** Object kind as the server knows it: table, view, type, function or aggregate. */
  kind: string
  keyspace: string
  name: string
  /** Required for functions and aggregates. */
  signature?: string
}

const icons: Record<string, ReactNode> = {
  keyspace: <Database size={13} />,
  table: <Table2 size={13} />,
  view: <Eye size={13} />,
  type: <Braces size={13} />,
  index: <Search size={13} />,
  trigger: <Zap size={13} />,
  function: <FunctionSquare size={13} />,
  aggregate: <Sigma size={13} />,
}

/** Tab kinds that can be opened from a dependency item; aggregates, indexes and triggers have no tab yet. */
const openable = new Set(['table', 'view', 'type', 'function'])

function Section({ title, items, empty, onOpen }: { title: string; items: DepItem[]; empty: string; onOpen: (i: DepItem) => void }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 mt-0 text-[13px] font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="m-0 text-muted">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
          {items.map((i) => {
            const label = `${i.keyspace ? `${i.keyspace}.` : ''}${i.signature ?? i.name}`
            const can = openable.has(i.kind)
            return (
              <li key={`${i.kind}|${label}|${i.via}`} className="flex items-center gap-2">
                <span className="text-muted" aria-hidden>
                  {icons[i.kind]}
                </span>
                {can ? (
                  <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-mono text-accent hover:underline" onClick={() => onOpen(i)}>
                    {label}
                  </button>
                ) : (
                  <span className="font-mono">{label}</span>
                )}
                <span className="text-muted">via {i.via}</span>
                {i.blocking && (
                  <span className="inline-flex items-center gap-1 rounded border border-line px-1 text-[11px] text-muted" title="Cassandra refuses to drop the target while this exists">
                    <Lock size={10} aria-hidden /> blocks drop
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * The Dependencies sub-view: "Used by" (objects that depend on this one) and "Depends on" lists, each item with a kind
 * icon, qualified name and "via" label. Items that block a drop carry a lock badge; clicking a table, view, type or function opens its tab.
 */
export function DependencyPanel({ kind, keyspace, name, signature }: DependencyPanelProps) {
  const profileId = useWorkspace((s) => s.profileId)
  const open = useWorkspace((s) => s.open)
  const { data, error, isLoading } = useDeps(profileId, { kind, keyspace, name, signature })
  if (error) return <p role="alert" className="m-3 rounded-md bg-err-bg px-3 py-2 text-[12.5px] text-danger">{describeError(error)}</p>
  if (isLoading || !data) return <p className="p-4 text-muted">Reading dependencies…</p>
  const onOpen = (i: DepItem) => open(i.kind as 'table' | 'view' | 'type' | 'function', i.keyspace, i.kind === 'function' ? (i.signature ?? i.name) : i.name)
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px] md:grid md:grid-cols-2 md:gap-7">
        <Section title="Used by" items={data.dependents} empty={`Nothing depends on ${name}`} onOpen={onOpen} />
        <div className="max-md:mt-[22px]">
          <Section title="Depends on" items={data.dependencies} empty={`${name} does not depend on anything`} onOpen={onOpen} />
        </div>
      </div>
    </div>
  )
}
