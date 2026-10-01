import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { StatusDot } from '../ui/StatusDot'
import { useConnect, useProfiles } from '../api/hooks'
import { useWorkspace } from '../store/workspace'

/**
 * Title-bar profile button with a status dot. The menu lists profiles from the API; choosing one makes
 * it active and connects (connecting, connected or error shows on its dot). "Manage profiles" opens the dialog.
 */
export function ProfileSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const profileId = useWorkspace((s) => s.profileId)
  const connections = useWorkspace((s) => s.connections)
  const setProfile = useWorkspace((s) => s.setProfile)
  const openDialog = useWorkspace((s) => s.setProfileDialogOpen)
  const { data: profiles = [] } = useProfiles()
  const connect = useConnect()
  const status = (name: string) => connections[name]?.status ?? (profiles.find((p) => p.name === name)?.connected ? 'connected' : 'idle')
  const current = profiles.find((p) => p.name === profileId)
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
        {current ? <StatusDot status={status(current.name)} /> : null}
        {current?.name ?? 'No profile'}
        <ChevronDown size={12} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} role="menu" aria-label="Profiles" className="w-64 p-1">
        {profiles.map((p) => {
          const c = connections[p.name]
          return (
            <button
              key={p.name}
              role="menuitemradio"
              aria-checked={p.name === profileId}
              onClick={() => {
                setProfile(p.name)
                setOpen(false)
                if (status(p.name) !== 'connected') connect.mutate(p.name)
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover ${p.name === profileId ? 'bg-selected' : ''}`}
            >
              <StatusDot status={status(p.name)} />
              <span className="min-w-0">
                {p.name}
                <small className={`block truncate font-mono text-[11.5px] ${c?.status === 'error' ? 'text-danger' : 'text-faint'}`}>
                  {c?.status === 'error' ? c.error : p.astra.secure_bundle ? 'Astra DB bundle' : p.hosts.join(', ')}
                </small>
              </span>
            </button>
          )
        })}
        {profiles.length > 0 && <div className="my-1 h-px bg-line2" />}
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
