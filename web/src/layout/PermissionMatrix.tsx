import { resourceKey, resourceLabel } from '../lib/roles'
import type { RoleResource } from '../api/types'

export interface PermissionMatrixProps {
  /** One row per resource. */
  resources: RoleResource[]
  /** Permissions that apply to each resource kind (from the server). */
  applicable: Record<string, string[]>
  /** `resourceKey|PERMISSION` entries currently granted on the server. */
  granted: Set<string>
  /** `resourceKey|PERMISSION` entries with a pending toggle. */
  pending: Set<string>
  /** Disables every checkbox (authorization is off or a request is running). */
  disabled?: boolean
  /** Called with the cell and whether it should now be granted. */
  onToggle: (resource: RoleResource, permission: string, grant: boolean) => void
}

/** The permission names that appear as columns, ordered. */
const COLUMNS = ['ALL', 'CREATE', 'ALTER', 'DROP', 'SELECT', 'MODIFY', 'AUTHORIZE', 'DESCRIBE', 'EXECUTE', 'UNMASK', 'SELECT_MASKED']

/**
 * Resources × permissions grid. A cell is a checkbox only where the pair is applicable (for example EXECUTE exists only
 * for functions); other cells show a dash. A cell's state is "granted on the server" flipped by any pending toggle,
 * and pending cells are outlined so they are visible before they are applied.
 */
export function PermissionMatrix({ resources, applicable, granted, pending, disabled, onToggle }: PermissionMatrixProps) {
  const cols = COLUMNS.filter((c) => Object.values(applicable).some((l) => l.includes(c)))
  if (resources.length === 0) return <p className="m-0 text-[12.5px] text-muted">No permissions yet. Use “Add resource” to grant some.</p>
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-muted">Resource</th>
            {cols.map((c) => (
              <th key={c} className="px-2 py-1 font-mono text-[11px] font-medium text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const rk = resourceKey(r)
            return (
              <tr key={rk} className="border-t border-line2">
                <td className="whitespace-nowrap px-2 py-1 font-mono">{resourceLabel(r)}</td>
                {cols.map((c) => {
                  if (!(applicable[r.kind] ?? []).includes(c)) {
                    return (
                      <td key={c} className="px-2 py-1 text-center text-faint" aria-hidden>
                        —
                      </td>
                    )
                  }
                  const k = `${rk}|${c}`
                  const flipped = pending.has(k)
                  const checked = granted.has(k) !== flipped
                  return (
                    <td key={c} className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${c} on ${resourceLabel(r)}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={(e) => onToggle(r, c, e.target.checked)}
                        className={flipped ? 'outline outline-2 outline-accent' : undefined}
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
