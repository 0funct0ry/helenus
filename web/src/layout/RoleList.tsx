import { Badge } from '../ui/Badge'
import { cn } from '../lib/cn'
import type { RoleInfo } from '../api/types'

export interface RoleListProps {
  roles: RoleInfo[]
  selected: string
  onSelect: (role: string) => void
}

/** The list of roles, one button per role with Login and Superuser badges and a "member of" hint; the selected role is highlighted. */
export function RoleList({ roles, selected, onSelect }: RoleListProps) {
  if (roles.length === 0) return <p className="m-3 text-[12.5px] text-muted">No roles.</p>
  return (
    <ul aria-label="Roles" className="m-0 list-none p-0">
      {roles.map((r) => (
        <li key={r.name}>
          <button
            type="button"
            onClick={() => onSelect(r.name)}
            aria-current={r.name === selected}
            className={cn('flex w-full items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left hover:bg-hover', r.name === selected && 'bg-selected')}
          >
            <span className="font-mono">{r.name}</span>
            {r.superuser && <Badge tone="udt">superuser</Badge>}
            {r.login && <Badge>login</Badge>}
            {r.member_of.length > 0 && <span className="ml-auto truncate text-[11.5px] text-faint">in {r.member_of.join(', ')}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
