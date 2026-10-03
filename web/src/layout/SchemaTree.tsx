import { useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Braces, Copy, Database, ExternalLink, Eye, FileText, FunctionSquare, Lock, Zap, Plus, RefreshCw, Search, Table2 } from 'lucide-react'
import { TreeRow } from './TreeRow'
import { SchemaContextMenu } from './SchemaContextMenu'
import { NewTypeDialog } from './NewTypeDialog'
import type { ContextMenuItem } from './SchemaContextMenu'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { IconButton } from '../ui/IconButton'
import { useCopyDdl, useRefreshSchema, useSchema } from '../api/hooks'
import type { DdlObject } from '../api/hooks'
import { describeError } from '../api/client'
import { keySummary } from '../lib/keySummary'
import { useWorkspace } from '../store/workspace'
import type { Keyspace, Table } from '../lib/schemaModel'

const defaultClosed = (key: string) => key.startsWith('fn:') || key.startsWith('trg:') || key === 'system'

type ObjectKind = 'table' | 'view' | 'type' | 'keyspace'
interface MenuState {
  x: number
  y: number
  keyspace: string
  kind: ObjectKind
  name: string
}

/**
 * The left dock: a filter box and the keyspace tree built from the connected profile's real schema
 * (Tables, Views, Types, Functions, Triggers per keyspace, with system keyspaces collapsed under a System
 * group). Table rows show a key summary on hover, list their materialized views as children and
 * expand to columns with key markers and type badges while selected. Right-click opens a context
 * menu (Open, New query here, Copy name, Copy DDL, Refresh); the toolbar button re-reads metadata.
 */
export function SchemaTree() {
  const [filter, setFilter] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [newTypeKs, setNewTypeKs] = useState<string | null>(null)
  const active = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeId))
  const open = useWorkspace((s) => s.open)
  const newQuery = useWorkspace((s) => s.newQuery)
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces, isLoading, error, refetch } = useSchema(profileId, connected)
  const refresh = useRefreshSchema(profileId)
  const copyDdl = useCopyDdl(profileId)

  const q = filter.trim().toLowerCase()
  const isOpen = (key: string) => (q ? true : (toggled[key] ?? !defaultClosed(key)))
  const toggle = (key: string) => setToggled((t) => ({ ...t, [key]: !isOpen(key) }))
  const match = (s: string) => !q || s.toLowerCase().includes(q)

  const user = useMemo(() => (keyspaces ?? []).filter((k) => !k.system), [keyspaces])
  const system = useMemo(() => (keyspaces ?? []).filter((k) => k.system), [keyspaces])
  const counts = {
    keyspaces: user.length,
    tables: user.reduce((n, k) => n + k.tables.length, 0),
    types: user.reduce((n, k) => n + k.types.length, 0),
  }

  const isSel = (kind: string, ks: string, name: string) => !!active && active.kind === kind && active.keyspace === ks && active.object === name

  const onContext = (e: MouseEvent, keyspace: string, kind: ObjectKind, name: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, keyspace, kind, name })
  }

  const menuItems = (m: MenuState): ContextMenuItem[] => {
    if (m.kind === 'keyspace')
      return [
        { label: 'New type…', icon: <Braces size={14} />, onSelect: () => setNewTypeKs(m.keyspace) },
        { label: 'New query here', icon: <FileText size={14} />, onSelect: () => newQuery({ keyspace: m.keyspace }) },
        { label: 'Copy name', icon: <Copy size={14} />, onSelect: () => void navigator.clipboard?.writeText(m.keyspace) },
        { label: 'Refresh', icon: <RefreshCw size={14} />, onSelect: () => refresh.mutate() },
      ]
    const fq = `${m.keyspace}.${m.name}`
    const kind = m.kind
    const ddlObject: DdlObject = kind
    return [
      { label: 'Open', icon: <ExternalLink size={14} />, onSelect: () => open(kind, m.keyspace, m.name) },
      {
        label: 'New query here',
        icon: <FileText size={14} />,
        onSelect: () => newQuery({ keyspace: m.keyspace, cql: kind === 'type' ? undefined : `SELECT * FROM ${fq} LIMIT 100;` }),
      },
      { label: 'Copy name', icon: <Copy size={14} />, onSelect: () => void navigator.clipboard?.writeText(fq) },
      { label: 'Copy DDL', icon: <Copy size={14} />, onSelect: () => void copyDdl(m.keyspace, ddlObject, m.name) },
      { label: 'Refresh', icon: <RefreshCw size={14} />, onSelect: () => refresh.mutate() },
    ]
  }

  const renderColumns = (t: Table) => (
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
  )

  const renderKeyspace = (k: Keyspace) => {
    const tables = k.tables.filter((t) => match(t.name) || match(k.name))
    const views = k.views.filter((v) => match(v.name) || match(k.name))
    const types = k.types.filter((t) => match(t.name) || match(k.name))
    const fns = k.functions.filter((f) => match(f) || match(k.name))
    const triggers = (k.triggers ?? []).filter((g) => match(g.name) || match(g.table) || match(k.name))
    if (q && !tables.length && !views.length && !types.length && !fns.length && !triggers.length && !match(k.name)) return null
    const kOpen = isOpen(`ks:${k.name}`)
    const group = (id: string, name: string, count: number, children: ReactNode, add?: { label: string; run: () => void }) =>
      count > 0 || !q ? (
        <div key={id}>
          <div className="group relative">
            <TreeRow indent={22} label={name} muted expanded={isOpen(id)} meta={count} onClick={() => toggle(id)} />
            {add && (
              <IconButton
                label={add.label}
                icon={<Plus size={13} />}
                onClick={add.run}
                className="absolute right-7 top-[1px] opacity-0 focus:opacity-100 group-hover:opacity-100"
              />
            )}
          </div>
          {isOpen(id) && children}
        </div>
      ) : null
    const viewRow = (v: Keyspace['views'][number], indent: number, key = v.name) => (
      <div key={key} onContextMenu={(e) => onContext(e, k.name, 'view', v.name)}>
        <TreeRow indent={indent} label={v.name} mono selected={isSel('view', k.name, v.name)} icon={<Eye size={14} />} title={keySummary(v.columns)} onClick={() => open('view', k.name, v.name)} />
      </div>
    )
    return (
      <div key={k.name} role="group">
        <div onContextMenu={(e) => onContext(e, k.name, 'keyspace', k.name)}>
          <TreeRow indent={6} label={k.name} icon={<Database size={14} />} expanded={kOpen} meta={k.system ? undefined : k.replication} onClick={() => toggle(`ks:${k.name}`)} />
        </div>
        {kOpen && (
          <>
            {group(
              `tables:${k.name}`,
              'Tables',
              tables.length,
              tables.map((t) => {
                const sel = isSel('table', k.name, t.name)
                const children = k.views.filter((v) => v.baseTable === t.name)
                return (
                  <div key={t.name} onContextMenu={(e) => onContext(e, k.name, 'table', t.name)}>
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
                    {sel && renderColumns(t)}
                    {children.map((v) => viewRow(v, 58, `${t.name}/${v.name}`))}
                  </div>
                )
              }),
            )}
            {group(`views:${k.name}`, 'Views', views.length, views.map((v) => viewRow(v, 40)))}
            {group(
              `types:${k.name}`,
              'Types',
              types.length,
              types.map((t) => (
                <div key={t.name} onContextMenu={(e) => onContext(e, k.name, 'type', t.name)}>
                  <TreeRow indent={40} label={t.name} mono selected={isSel('type', k.name, t.name)} icon={<Braces size={14} />} onClick={() => open('type', k.name, t.name)} />
                </div>
              )),
              { label: `New type in ${k.name}`, run: () => setNewTypeKs(k.name) },
            )}
            {group(
              `fn:${k.name}`,
              'Functions',
              fns.length,
              fns.map((f) => <TreeRow key={f} indent={40} label={f} mono icon={<FunctionSquare size={14} />} />),
            )}
            {group(
              `trg:${k.name}`,
              'Triggers',
              triggers.length,
              triggers.map((g) => (
                <TreeRow key={`${g.table}/${g.name}`} indent={40} label={`${g.table}.${g.name}`} mono icon={<Zap size={14} />} title={g.class} />
              )),
            )}
          </>
        )}
      </div>
    )
  }

  const body = (() => {
    if (!connected) return <p className="m-0 px-3 py-4 text-muted">Connect a profile to browse its schema.</p>
    if (isLoading) return <p className="m-0 px-3 py-4 text-muted">Reading schema…</p>
    if (error)
      return (
        <div className="px-3 py-4 text-muted" role="alert">
          <p className="mt-0">Could not read the schema: {describeError(error)}</p>
          <button type="button" className="text-accent hover:underline" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      )
    return (
      <>
        {user.map(renderKeyspace)}
        {(!q || system.some((k) => match(k.name))) && system.length > 0 && (
          <>
            <div className="mx-3 my-2 h-px bg-line2" />
            <TreeRow indent={6} label="System" muted expanded={isOpen('system')} icon={<Lock size={14} />} meta={`${system.length} keyspaces`} onClick={() => toggle('system')} />
            {isOpen('system') && system.filter((k) => match(k.name)).map((k) => <TreeRow key={k.name} indent={22} label={k.name} mono muted icon={<Database size={14} />} />)}
          </>
        )}
      </>
    )
  })()

  return (
    <aside aria-label="Schema" className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-1.5 border-b border-line2 py-1.5 pl-3 pr-2">
        <h2 className="m-0 text-[13px] font-medium">Schema</h2>
        <span className="flex-1" />
        <IconButton label="New query" icon={<Plus size={14} />} onClick={() => newQuery()} />
        <IconButton
          label="Refresh schema"
          icon={<RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : undefined} />}
          disabled={!connected || refresh.isPending}
          onClick={() => refresh.mutate()}
        />
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
        {body}
      </nav>
      {connected && keyspaces && (
        <div className="flex gap-2.5 border-t border-line2 px-3 py-1.5 text-xs text-muted">
          <span>{counts.keyspaces} keyspaces</span>
          <span>{counts.tables} tables</span>
          <span>{counts.types} types</span>
        </div>
      )}
      {newTypeKs && <NewTypeDialog keyspace={newTypeKs} onClose={() => setNewTypeKs(null)} />}
      {menu && <SchemaContextMenu x={menu.x} y={menu.y} label={menu.kind === 'keyspace' ? menu.keyspace : `${menu.keyspace}.${menu.name}`} items={menuItems(menu)} onClose={() => setMenu(null)} />}
    </aside>
  )
}
