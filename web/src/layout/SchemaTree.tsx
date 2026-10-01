import { useMemo, useState } from 'react'
import { Braces, Database, Eye, FunctionSquare, Lock, Plus, RefreshCw, Search, Table2 } from 'lucide-react'
import { TreeRow } from './TreeRow'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { IconButton } from '../ui/IconButton'
import { keyspaces } from '../mocks/schema'
import { keySummary } from '../lib/keySummary'
import { useWorkspace } from '../store/workspace'
import type { Keyspace } from '../mocks/types'

const defaultClosed = (key: string) => key.startsWith('fn:') || key === 'system'

/**
 * The left dock: a filter box and the keyspace tree (Tables, Views, Types, Functions per keyspace,
 * with system keyspaces collapsed under a System group). Table rows show a key summary on hover and
 * expand to their columns with key markers and type badges while selected.
 */
export function SchemaTree() {
  const [filter, setFilter] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const active = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeId))
  const open = useWorkspace((s) => s.open)
  const newQuery = useWorkspace((s) => s.newQuery)

  const q = filter.trim().toLowerCase()
  const isOpen = (key: string) => (q ? true : (toggled[key] ?? !defaultClosed(key)))
  const toggle = (key: string) => setToggled((t) => ({ ...t, [key]: !isOpen(key) }))
  const match = (s: string) => !q || s.toLowerCase().includes(q)

  const user = useMemo(() => keyspaces.filter((k) => !k.system), [])
  const system = useMemo(() => keyspaces.filter((k) => k.system), [])
  const counts = {
    keyspaces: user.length,
    tables: user.reduce((n, k) => n + k.tables.length, 0),
    types: user.reduce((n, k) => n + k.types.length, 0),
  }

  const isSel = (kind: string, ks: string, name: string) => !!active && active.kind === kind && active.keyspace === ks && active.object === name

  const renderKeyspace = (k: Keyspace) => {
    const tables = k.tables.filter((t) => match(t.name) || match(k.name))
    const views = k.views.filter((v) => match(v.name) || match(k.name))
    const types = k.types.filter((t) => match(t.name) || match(k.name))
    const fns = k.functions.filter((f) => match(f) || match(k.name))
    if (q && !tables.length && !views.length && !types.length && !fns.length && !match(k.name)) return null
    const kOpen = isOpen(`ks:${k.name}`)
    const group = (id: string, name: string, count: number, children: React.ReactNode) =>
      count > 0 || !q ? (
        <div key={id}>
          <TreeRow indent={22} label={name} muted expanded={isOpen(id)} meta={count} onClick={() => toggle(id)} />
          {isOpen(id) && children}
        </div>
      ) : null
    return (
      <div key={k.name} role="group">
        <TreeRow indent={6} label={k.name} icon={<Database size={14} />} expanded={kOpen} meta={k.system ? undefined : 'NTS · eu-west-1:3'} onClick={() => toggle(`ks:${k.name}`)} />
        {kOpen && (
          <>
            {group(
              `tables:${k.name}`,
              'Tables',
              tables.length,
              tables.map((t) => {
                const sel = isSel('table', k.name, t.name)
                return (
                  <div key={t.name}>
                    <TreeRow
                      indent={40}
                      label={t.name}
                      mono
                      selected={sel}
                      icon={<Table2 size={14} />}
                      meta={t.counter ? 'counter' : undefined}
                      title={keySummary(t.columns)}
                      onClick={() => open('table', k.name, t.name)}
                    />
                    {sel && (
                      <>
                        {t.columns.slice(0, 6).map((c) => (
                          <div key={c.name} className="flex h-6 items-center gap-[5px] pl-[58px] pr-2" role="treeitem" aria-selected="false">
                            <span className="inline-flex w-[26px] shrink-0">
                              <KeyMarker kind={c.kind} position={c.position} order={c.order} />
                            </span>
                            <span className="overflow-hidden text-ellipsis font-mono text-xs text-muted">{c.name}</span>
                            <span className="ml-auto">
                              <TypeBadge type={c.type} />
                            </span>
                          </div>
                        ))}
                        {t.columns.length > 6 && <div className="flex h-6 items-center pl-[58px] text-xs text-faint">{t.columns.length - 6} more columns</div>}
                      </>
                    )}
                  </div>
                )
              }),
            )}
            {group(
              `views:${k.name}`,
              'Views',
              views.length,
              views.map((v) => <TreeRow key={v.name} indent={40} label={v.name} mono selected={isSel('view', k.name, v.name)} icon={<Eye size={14} />} title={keySummary(v.columns)} onClick={() => open('view', k.name, v.name)} />),
            )}
            {group(
              `types:${k.name}`,
              'Types',
              types.length,
              types.map((t) => <TreeRow key={t.name} indent={40} label={t.name} mono selected={isSel('type', k.name, t.name)} icon={<Braces size={14} />} onClick={() => open('type', k.name, t.name)} />),
            )}
            {group(
              `fn:${k.name}`,
              'Functions',
              fns.length,
              fns.map((f) => <TreeRow key={f} indent={40} label={f} mono icon={<FunctionSquare size={14} />} />),
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <aside aria-label="Schema" className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-1.5 border-b border-line2 py-1.5 pl-3 pr-2">
        <h2 className="m-0 flex-1 text-[13px] font-medium">Schema</h2>
        <IconButton label="New query" icon={<Plus size={14} />} onClick={newQuery} />
        <IconButton label="Refresh schema" icon={<RefreshCw size={14} />} />
      </div>
      <label className="m-2 flex h-[26px] items-center gap-1.5 rounded border border-line bg-editor px-2 text-muted focus-within:border-focus">
        <Search size={14} aria-hidden />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter keyspaces, tables, types"
          aria-label="Filter schema"
          className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-faint"
        />
      </label>
      <nav role="tree" aria-label="Schema tree" className="flex-1 overflow-auto pb-3 pt-0.5">
        {user.map(renderKeyspace)}
        {(!q || system.some((k) => match(k.name))) && (
          <>
            <div className="mx-3 my-2 h-px bg-line2" />
            <TreeRow indent={6} label="System" muted expanded={isOpen('system')} icon={<Lock size={14} />} meta={`${system.length} keyspaces`} onClick={() => toggle('system')} />
            {isOpen('system') && system.filter((k) => match(k.name)).map((k) => <TreeRow key={k.name} indent={22} label={k.name} mono muted icon={<Database size={14} />} />)}
          </>
        )}
      </nav>
      <div className="flex gap-2.5 border-t border-line2 px-3 py-1.5 text-xs text-muted">
        <span>{counts.keyspaces} keyspaces</span>
        <span>{counts.tables} tables</span>
        <span>{counts.types} types</span>
      </div>
    </aside>
  )
}
