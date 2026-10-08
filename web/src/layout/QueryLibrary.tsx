import { useMemo, useState } from 'react'
import { ChevronDown, FileText, Folder, MoreHorizontal, Search } from 'lucide-react'
import { SchemaContextMenu } from './SchemaContextMenu'
import type { ContextMenuItem } from './SchemaContextMenu'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'
import { Badge } from '../ui/Badge'
import { cn } from '../lib/cn'
import { describeError } from '../api/client'
import { useQueries, useQueryMutations } from '../api/useQueries'
import type { SavedQuery } from '../api/useQueries'
import { useQueryActions } from '../api/useQueryActions'
import { useQueryDialogs } from '../store/queryDialogs'
import { useToasts } from '../store/toast'
import { useWorkspace } from '../store/workspace'

interface Node {
  /** Folder path or full query name. */
  path: string
  label: string
  query?: SavedQuery
  children: Node[]
}

function buildTree(queries: SavedQuery[]): Node[] {
  const root: Node = { path: '', label: '', children: [] }
  const cmp = (a: Node, b: Node) => Number(!!a.query) - Number(!!b.query) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || Number(!!a.query?.global) - Number(!!b.query?.global)
  for (const q of queries) {
    const parts = q.name.split('/')
    let at = root
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const leaf = i === parts.length - 1
      let next = at.children.find((c) => c.label === part && !!c.query === leaf && (!leaf || c.query?.id === q.id))
      if (!next) {
        next = { path, label: leaf ? part.replace(/\.cql$/i, '') : part, children: [], ...(leaf && { query: q }) }
        at.children.push(next)
      }
      at = next
    })
  }
  const sort = (n: Node) => {
    n.children.sort(cmp)
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

/** Folder paths that contain a query whose full name matches the (lower-case) filter. */
function matchingFolders(queries: SavedQuery[], f: string): Set<string> {
  const out = new Set<string>()
  for (const q of queries) {
    if (!q.name.toLowerCase().includes(f)) continue
    const parts = q.name.split('/')
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  return out
}

/**
 * The "Queries" dock tab: the saved-query library as a tree of folders (implied by `/` in names) and queries, with a
 * filter box (case-insensitive substring of the full name; folders with matches expand), a "Global" badge on global
 * queries and a menu per query (right-click, Shift+F10 or the hover ⋯ button): Open, Open in new tab, Rename / Move…,
 * Duplicate, Copy name, Download .cql, Delete… (confirmed in a dialog). Clicking a query opens it.
 */
export function QueryLibrary() {
  const profile = useWorkspace((s) => s.profileId)
  const { data: queries = [], isLoading, error } = useQueries(profile)
  const m = useQueryMutations(profile)
  const actions = useQueryActions()
  const toast = useToasts((s) => s.push)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; q: SavedQuery } | null>(null)
  const [deleting, setDeleting] = useState<SavedQuery | null>(null)

  const f = filter.trim().toLowerCase()
  const shown = useMemo(() => (f ? queries.filter((q) => q.name.toLowerCase().includes(f)) : queries), [queries, f])
  const tree = useMemo(() => buildTree(shown), [shown])
  const forced = useMemo(() => matchingFolders(queries, f), [queries, f])

  const toggle = (path: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })

  const remove = async (q: SavedQuery) => {
    setDeleting(null)
    try {
      await m.remove.mutateAsync(q.id)
      for (const t of useWorkspace.getState().unbindQuery(q.id)) toast(`${t} was deleted from the library; the tab is now unsaved`)
    } catch (e) {
      toast(`Could not delete ${q.name}: ${describeError(e)}`)
    }
  }
  const duplicate = async (q: SavedQuery) => {
    try {
      const row = await m.duplicate.mutateAsync(q.id)
      toast(`Duplicated as ${row.name}`)
    } catch (e) {
      toast(`Could not duplicate ${q.name}: ${describeError(e)}`)
    }
  }
  const items = (q: SavedQuery): ContextMenuItem[] => [
    { label: 'Open', onSelect: () => void actions.openQuery(q) },
    { label: 'Open in new tab', onSelect: () => void actions.openQuery(q, true) },
    { label: 'Rename / Move…', separatorBefore: true, onSelect: () => useQueryDialogs.getState().set({ rename: q }) },
    { label: 'Duplicate', onSelect: () => void duplicate(q) },
    { label: 'Copy name', onSelect: () => void navigator.clipboard?.writeText(q.name) },
    { label: 'Download .cql', onSelect: () => void actions.downloadQuery(q) },
    { label: 'Delete…', separatorBefore: true, danger: true, onSelect: () => setDeleting(q) },
  ]
  const openMenuAt = (q: SavedQuery, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setMenu({ x: r.left, y: r.bottom, q })
  }

  const row = (n: Node, depth: number) => {
    const pad = 12 + depth * 14
    if (!n.query) {
      const open = f ? forced.has(n.path) || !collapsed.has(n.path) : !collapsed.has(n.path)
      return (
        <li key={`f:${n.path}`} role="none">
          <button type="button" role="treeitem" aria-expanded={open} onClick={() => toggle(n.path)} style={{ paddingLeft: pad }} className="flex h-6 w-full items-center gap-[5px] pr-2 text-left hover:bg-hover">
            <ChevronDown size={14} className={cn('shrink-0 text-muted transition-transform', !open && '-rotate-90')} aria-hidden />
            <Folder size={14} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate">{n.label}</span>
          </button>
          {open && <ul role="group" className="m-0 list-none p-0">{n.children.map((c) => row(c, depth + 1))}</ul>}
        </li>
      )
    }
    const q = n.query
    return (
      <li key={`q:${q.id}`} role="none" className="group relative">
        <button
          type="button"
          role="treeitem"
          aria-selected={false}
          title={q.global ? `${q.name} (Global)` : q.name}
          onClick={() => void actions.openQuery(q)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, q })
          }}
          onKeyDown={(e) => {
            if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
              e.preventDefault()
              openMenuAt(q, e.currentTarget)
            }
          }}
          style={{ paddingLeft: pad + 14 }}
          className="flex h-6 w-full items-center gap-[5px] whitespace-nowrap pr-8 text-left hover:bg-hover"
        >
          <FileText size={14} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 truncate">{n.label}</span>
          {q.global && <Badge className="ml-auto">Global</Badge>}
        </button>
        <IconButton
          label={`Actions for ${q.name}`}
          icon={<MoreHorizontal size={14} />}
          onClick={(e) => openMenuAt(q, e.currentTarget)}
          className="absolute right-1 top-0.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        />
      </li>
    )
  }

  return (
    <section aria-label="Queries" className="flex min-h-0 flex-1 flex-col">
      <label className="m-2 flex h-[26px] items-center gap-1.5 rounded border border-line bg-editor px-2 text-muted focus-within:border-focus">
        <Search size={14} aria-hidden />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter saved queries" aria-label="Filter saved queries" className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-faint" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {error ? (
          <p role="alert" className="m-3 text-danger">
            {describeError(error)}
          </p>
        ) : isLoading ? (
          <p className="m-3 text-muted">Loading…</p>
        ) : queries.length === 0 ? (
          <p className="m-3 text-muted">No saved queries yet. Press ⌘S in a query tab to save one.</p>
        ) : shown.length === 0 ? (
          <p className="m-3 text-muted">No saved queries match “{filter.trim()}”.</p>
        ) : (
          <ul role="tree" aria-label="Saved queries" className="m-0 list-none p-0">
            {tree.map((n) => row(n, 0))}
          </ul>
        )}
      </div>
      {menu && <SchemaContextMenu x={menu.x} y={menu.y} label={`Actions for ${menu.q.name}`} items={items(menu.q)} onClose={() => setMenu(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete saved query?"
        message={deleting ? `“${deleting.name}” will be removed from the library. Tabs showing it keep their text.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </section>
  )
}
