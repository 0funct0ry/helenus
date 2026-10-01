import { Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { StatusDot } from '../ui/StatusDot'
import type { ApiProfile } from '../api/types'
import type { Connection } from '../store/workspace'

export interface ProfileListPaneProps {
  profiles: ApiProfile[]
  /** Selected profile name, or undefined when a new profile is being created. */
  selected?: string
  connections: Record<string, Connection>
  onSelect: (name: string) => void
  onNew: () => void
}

/** The left column of the profile dialog: one row per saved profile with a status dot, and a "New profile" button. */
export function ProfileListPane({ profiles, selected, connections, onSelect, onNew }: ProfileListPaneProps) {
  return (
    <div role="listbox" aria-label="Profiles" className="overflow-auto border-r border-line2 bg-surface p-1.5">
      {profiles.map((p) => (
        <button
          key={p.name}
          role="option"
          aria-selected={p.name === selected}
          onClick={() => onSelect(p.name)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover ${p.name === selected ? 'bg-selected' : ''}`}
        >
          <StatusDot status={connections[p.name]?.status ?? (p.connected ? 'connected' : 'idle')} />
          <div className="min-w-0">
            {p.name}
            <small className="block truncate font-mono text-[11.5px] text-faint">{p.astra.secure_bundle ? 'Astra DB bundle' : p.hosts.join(', ')}</small>
          </div>
        </button>
      ))}
      <Button variant="ghost" className="mt-1.5 w-full" icon={<Plus size={14} />} onClick={onNew}>
        New profile
      </Button>
    </div>
  )
}
