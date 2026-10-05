import type { KeyboardEvent } from 'react'
import { Braces, Eye, FileText, FunctionSquare, Plus, Table2, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { IconButton } from '../ui/IconButton'
import type { TabKind } from '../store/workspace'

export interface TabBarItem {
  id: string
  kind: TabKind
  title: string
  closable?: boolean
  /** Shows an accent dot for unsaved/pending state. */
  modified?: boolean
}

export interface TabBarProps {
  tabs: TabBarItem[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

const icons = { table: Table2, view: Eye, query: FileText, type: Braces, function: FunctionSquare }

/**
 * Zed-style editor tab strip. Each tab is a tab button plus an optional close button (visible on
 * hover or when active). Arrow keys move between tabs; Delete closes the focused tab.
 */
export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === activeId)
    if (i < 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      onSelect(tabs[next].id)
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    } else if (e.key === 'Delete' && tabs[i].closable !== false) {
      onClose(tabs[i].id)
    }
  }
  return (
    <div className="flex h-8 flex-none border-b border-line bg-surface">
      <div role="tablist" aria-label="Open tabs" onKeyDown={onKey} className="no-scrollbar flex min-w-0 overflow-x-auto overflow-y-hidden">
        {tabs.map((t) => {
          const active = t.id === activeId
          const Icon = icons[t.kind]
          return (
            <div
              key={t.id}
              role="presentation"
              className={cn('group relative flex min-w-0 items-center gap-1.5 border-r border-line pl-3 pr-2', active ? 'bg-editor text-fg' : 'text-muted hover:text-fg')}
            >
              {active && <span className="absolute inset-x-0 -bottom-px h-px bg-editor" />}
              <button
                role="tab"
                type="button"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(t.id)}
                className="flex h-full min-w-0 items-center gap-[7px]"
              >
                <Icon size={14} className="shrink-0" aria-hidden />
                <span className="truncate">{t.title}</span>
                {t.modified && <span className="size-1.5 rounded-full bg-accent" title="Pending changes" />}
              </button>
              {t.closable !== false && (
                <button
                  type="button"
                  aria-label={`Close ${t.title}`}
                  onClick={() => onClose(t.id)}
                  className={cn('grid size-[18px] place-items-center rounded-[3px] hover:bg-hover focus-visible:opacity-100', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex-1" />
      <IconButton label="New query tab" icon={<Plus size={14} />} onClick={onNew} className="mx-1.5 my-[5px]" />
    </div>
  )
}
