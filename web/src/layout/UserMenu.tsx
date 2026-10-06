import { useRef, useState } from 'react'
import { CircleUser, LogOut } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { useLogout } from '../api/useAuth'

export interface UserMenuProps {
  /** Signed-in username shown in the menu. */
  username: string
}

/** Title-bar user button; its menu names the signed-in user and offers Sign out. Rendered only when sign-in is on. */
export function UserMenu({ username }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const logout = useLogout()
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`User menu: ${username}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-muted hover:bg-hover hover:text-fg"
      >
        <CircleUser size={14} aria-hidden />
        {username}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="end" role="menu" aria-label="User" className="w-[200px] p-1">
        <div className="px-2 py-1.5 text-xs text-muted">Signed in as <b className="font-medium text-fg">{username}</b></div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false)
            logout.mutate()
          }}
          className="flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover"
        >
          <LogOut size={14} aria-hidden />
          Sign out
        </button>
      </Popover>
    </>
  )
}
