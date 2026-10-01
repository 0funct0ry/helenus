import { useId, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '../ui/Button'

export interface SecretFieldProps {
  label: string
  /** Newly typed value; never the stored secret. */
  value: string
  onChange: (value: string) => void
  /** A secret is already stored on the server. */
  isSet: boolean
  /** Where the stored secret comes from, e.g. "password command"; such secrets cannot be changed here. */
  source?: string
  /** The user chose to remove the stored secret on save. */
  cleared: boolean
  onClear: (cleared: boolean) => void
  placeholder?: string
}

/**
 * A write-only secret input. The server never returns secrets, so a stored one shows as "Saved" with
 * Change and Remove actions; typing a value replaces it, and leaving it alone keeps it.
 */
export function SecretField({ label, value, onChange, isSet, source, cleared, onClear, placeholder }: SecretFieldProps) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const showStored = isSet && !cleared && !editing && value === ''
  return (
    <div className="mb-3 flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        {showStored ? (
          <>
            <span id={id} className="flex h-7 flex-1 items-center gap-1.5 rounded border border-dashed border-line px-2 text-muted">
              <Lock size={12} aria-hidden />
              {source ? `Set from ${source}` : 'Saved'}
            </span>
            {!source && <Button onClick={() => setEditing(true)}>Change</Button>}
            {!source && (
              <Button variant="danger" onClick={() => onClear(true)}>
                Remove
              </Button>
            )}
          </>
        ) : (
          <>
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              className="h-7 w-full flex-1 rounded border border-line bg-editor px-2 font-mono text-[12.5px] placeholder:text-faint focus:border-focus"
              value={value}
              placeholder={cleared ? 'Will be removed on save' : placeholder}
              onChange={(e) => {
                onChange(e.target.value)
                if (cleared) onClear(false)
              }}
              autoFocus={editing}
            />
            {(cleared || editing) && (
              <Button
                onClick={() => {
                  onClear(false)
                  onChange('')
                  setEditing(false)
                }}
              >
                {cleared ? 'Undo' : 'Cancel'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
