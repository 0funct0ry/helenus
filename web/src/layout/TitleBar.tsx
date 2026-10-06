import { ChevronRight, Eye, Search, Shield } from 'lucide-react'
import { ProfileSwitcher } from './ProfileSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { useWorkspace } from '../store/workspace'
import { useProfiles } from '../api/hooks'
import { useAuthGate } from '../api/useAuth'
import { UserMenu } from './UserMenu'

/**
 * 34px application title bar: product mark, profile switcher, a keyspace/object breadcrumb for the
 * active tab, the command-palette launcher and the theme toggle.
 */
export function TitleBar() {
  const active = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeId))
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen)
  const openTab = useWorkspace((s) => s.open)
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const { data: profiles } = useProfiles()
  const { authEnabled, user } = useAuthGate()
  const astra = !!profiles?.find((p) => p.name === profileId)?.astra?.secure_bundle
  return (
    <header className="flex select-none items-center gap-1.5 border-b border-line bg-titlebar pl-3 pr-2">
      <div className="mr-1.5 flex items-center gap-[7px] font-semibold">
        <Eye size={16} className="text-accent" aria-hidden />
        helenus
      </div>
      <ProfileSwitcher />
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-muted">
        {active ? (
          <>
            <span>{active.keyspace}</span>
            {active.object && (
              <>
                <ChevronRight size={12} aria-hidden />
                <b className="font-medium text-fg">{active.object}</b>
              </>
            )}
            {!active.object && (
              <>
                <ChevronRight size={12} aria-hidden />
                <b className="font-medium text-fg">{active.title}</b>
              </>
            )}
          </>
        ) : (
          <span>No tab open</span>
        )}
      </nav>
      <div className="flex-1" />
      {connected && !astra && (
        <button type="button" onClick={() => openTab('security', '', 'Security')} className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-muted hover:bg-hover">
          <Shield size={14} aria-hidden />
          Security
        </button>
      )}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-muted hover:bg-hover"
      >
        <Search size={14} aria-hidden />
        Search or run a command
        <span className="rounded-[3px] border border-line px-1 font-mono text-[11px] leading-4">⌘K</span>
      </button>
      <ThemeToggle />
      {authEnabled && user && <UserMenu username={user} />}
    </header>
  )
}
