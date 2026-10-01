import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { StatusDot } from '../ui/StatusDot'
import { profiles } from '../mocks/profiles'
import { useWorkspace } from '../store/workspace'

/** Title-bar profile button with a status dot; opens a menu of profiles and a "Manage profiles" entry. */
export function ProfileSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const profileId = useWorkspace((s) => s.profileId)
  const setProfile = useWorkspace((s) => s.setProfile)
  const openDialog = useWorkspace((s) => s.setProfileDialogOpen)
  const current = profiles.find((p) => p.id === profileId) ?? profiles[0]
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch profile"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 items-center gap-1.5 rounded px-2 hover:bg-hover"
      >
        <StatusDot status={current.status} />
        {current.name}
        <ChevronDown size={12} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} role="menu" aria-label="Profiles" className="w-64 p-1">
        {profiles.map((p) => (
          <button
            key={p.id}
            role="menuitemradio"
            aria-checked={p.id === profileId}
            onClick={() => {
              setProfile(p.id)
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover ${p.id === profileId ? 'bg-selected' : ''}`}
          >
            <StatusDot status={p.status} />
            <span>
              {p.name}
              <small className="block font-mono text-[11.5px] text-faint">{p.status === 'error' ? p.error : p.hosts}</small>
            </span>
          </button>
        ))}
        <div className="my-1 h-px bg-line2" />
        <button
          role="menuitem"
          onClick={() => {
            setOpen(false)
            openDialog(true)
          }}
          className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-hover"
        >
          Manage profiles…
        </button>
      </Popover>
    </>
  )
}
