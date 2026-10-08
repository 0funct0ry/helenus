import { useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Activity, Database, Eye, FileText, FolderOpen, Lightbulb, Moon, Plus, Save, Shield, Table2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { useProfiles, useSchema } from '../api/hooks'
import { useQueries } from '../api/useQueries'
import { useQueryActions } from '../api/useQueryActions'
import { useToasts } from '../store/toast'
import { useWorkspace } from '../store/workspace'
import { useThemeStore } from '../store/theme'
import { cn } from '../lib/cn'

interface Action {
  id: string
  group: 'Tables and views' | 'Saved queries' | 'Commands'
  label: string
  icon: ReactNode
  mono?: boolean
  run: () => void
}

/**
 * Command palette dialog (opened with Cmd/Ctrl-K). A filter input over mock actions: open a table or
 * view, a saved query (by full name), new query, Save query, Save query as…, Open .cql file…, switch profile, toggle theme. Arrow keys move, Enter runs, Escape closes.
 */
export function CommandPalette() {
  const isOpen = useWorkspace((s) => s.paletteOpen)
  const setOpen = useWorkspace((s) => s.setPaletteOpen)
  if (!isOpen) return null
  return <PaletteBody onClose={() => setOpen(false)} />
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const open = useWorkspace((s) => s.open)
  const newQuery = useWorkspace((s) => s.newQuery)
  const openProfiles = useWorkspace((s) => s.setProfileDialogOpen)
  const reviewKeyspace = useWorkspace((s) => s.setReviewKeyspace)
  const cycleTheme = useThemeStore((s) => s.cycle)
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: keyspaces = [] } = useSchema(profileId, connected)
  const { data: profiles } = useProfiles()
  const { data: saved = [] } = useQueries(profileId)
  const qa = useQueryActions()
  const withQueryTab = (fn: (id: string) => void) => () => {
    const s = useWorkspace.getState()
    if (s.tabs.find((t) => t.id === s.activeId)?.kind === 'query') fn(s.activeId)
    else useToasts.getState().push('Open a query tab first')
  }
  const astra = !!profiles?.find((p) => p.name === profileId)?.astra?.secure_bundle

  const actions: Action[] = useMemo(
    () => [
      ...keyspaces
        .filter((k) => !k.system)
        .flatMap((k) => [
          ...k.tables.map<Action>((t) => ({ id: `t:${k.name}.${t.name}`, group: 'Tables and views', label: `${k.name}.${t.name}`, mono: true, icon: <Table2 size={14} />, run: () => open('table', k.name, t.name) })),
          ...k.views.map<Action>((v) => ({ id: `v:${k.name}.${v.name}`, group: 'Tables and views', label: `${k.name}.${v.name}`, mono: true, icon: <Eye size={14} />, run: () => open('view', k.name, v.name) })),
        ]),
      ...saved.map<Action>((q) => ({ id: `q:${q.id}`, group: 'Saved queries', label: q.name, icon: <FileText size={14} />, run: () => void qa.openQuery(q) })),
      { id: 'new-query', group: 'Commands', label: 'New query', icon: <Plus size={14} />, run: () => newQuery() },
      { id: 'save-query', group: 'Commands', label: 'Save query', icon: <Save size={14} />, run: withQueryTab((id) => void qa.save(id)) },
      { id: 'save-query-as', group: 'Commands', label: 'Save query as…', icon: <Save size={14} />, run: withQueryTab((id) => qa.saveAs(id)) },
      { id: 'open-file', group: 'Commands', label: 'Open .cql file…', icon: <FolderOpen size={14} />, run: qa.pickFile },
      { id: 'profiles', group: 'Commands', label: 'Switch profile…', icon: <Database size={14} />, run: () => openProfiles(true) },
      ...(astra ? [] : [{ id: 'security', group: 'Commands' as const, label: 'Security: roles and permissions', icon: <Shield size={14} />, run: () => open('security', '', 'Security') }]),
      ...['clients', 'settings', 'thread_pools', 'caches']
        .filter((n) => keyspaces.find((k) => k.name === 'system_views')?.tables.some((t) => t.name === n))
        .map<Action>((n) => ({ id: `insight:${n}`, group: 'Commands', label: `Cluster insights: ${n}`, icon: <Activity size={14} />, run: () => open('table', 'system_views', n) })),
      ...keyspaces.filter((k) => !k.system).map<Action>((k) => ({ id: `review:${k.name}`, group: 'Commands', label: `Review data model: ${k.name}`, icon: <Lightbulb size={14} />, run: () => reviewKeyspace(k.name) })),
      { id: 'theme', group: 'Commands', label: 'Toggle light and dark theme', icon: <Moon size={14} />, run: cycleTheme },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyspaces, saved, astra, open, newQuery, openProfiles, reviewKeyspace, cycleTheme],
  )
  const q = query.trim().toLowerCase()
  const shown = actions.filter((a) => a.label.toLowerCase().includes(q))
  const at = Math.min(index, Math.max(shown.length - 1, 0))

  const run = (a: Action | undefined) => {
    if (!a) return
    onClose()
    a.run()
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((at + 1) % Math.max(shown.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((at - 1 + shown.length) % Math.max(shown.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(shown[at])
    }
  }

  let lastGroup = ''
  return (
    <Dialog open onClose={onClose} title="Command palette" bare width="min(560px, 92vw)">
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
        }}
        onKeyDown={onKey}
        placeholder="Open a table, switch profile, or run a command"
        aria-label="Command"
        role="combobox"
        aria-expanded
        aria-controls="palette-list"
        aria-activedescendant={shown[at] ? `pal-${shown[at].id}` : undefined}
        className="w-full border-0 border-b border-line2 bg-transparent px-3.5 py-[11px] text-sm outline-none placeholder:text-faint"
      />
      <ul id="palette-list" role="listbox" aria-label="Actions" className="m-0 max-h-[50vh] list-none overflow-auto p-0 pb-1">
        {shown.length === 0 && <li className="px-3.5 py-3 text-muted">No matching commands</li>}
        {shown.map((a, i) => {
          const header = a.group !== lastGroup ? a.group : null
          lastGroup = a.group
          return (
            <li key={a.id} role="presentation">
              {header && <div className="px-3.5 pb-[3px] pt-2 text-[11.5px] text-faint">{header}</div>}
              <div
                id={`pal-${a.id}`}
                role="option"
                aria-selected={i === at}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(a)}
                className={cn('flex cursor-default items-center gap-2.5 px-3.5 py-[7px]', i === at && 'bg-selected')}
              >
                <span className="text-muted">{a.icon}</span>
                <span className={a.mono ? 'font-mono' : undefined}>{a.label}</span>
                {i === at && <span className="ml-auto rounded-[3px] border border-line px-1 font-mono text-[11px] leading-4 text-muted">↵</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
