import { Lock } from 'lucide-react'
import { StatusDot } from '../ui/StatusDot'
import { profiles } from '../mocks/profiles'
import { useWorkspace } from '../store/workspace'

/** 24px footer: profile status, server version, datacenter, TLS, consistency and cursor position. */
export function StatusBar() {
  const profileId = useWorkspace((s) => s.profileId)
  const consistency = useWorkspace((s) => s.consistency)
  const cursor = useWorkspace((s) => s.cursor)
  const activeKind = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeId)?.kind)
  const p = profiles.find((x) => x.id === profileId) ?? profiles[0]
  const item = 'inline-flex h-5 items-center gap-[5px] rounded-[3px] px-1.5'
  return (
    <footer className="flex items-center gap-0.5 border-t border-line bg-titlebar px-1.5 text-xs text-muted">
      <span className={item}>
        <StatusDot status={p.status} />
        {p.name}
      </span>
      {p.version && <span className={item}>{p.version}</span>}
      {p.datacenter && <span className={item}>{p.datacenter}</span>}
      {p.tls && (
        <span className={item}>
          <Lock size={12} aria-hidden />
          TLS
        </span>
      )}
      {p.status === 'error' && p.error && <span className={`${item} text-danger`}>{p.error}</span>}
      <div className="flex-1" />
      <span className={item}>{consistency}</span>
      {activeKind === 'query' && <span className={item}>{`Ln ${cursor.line}, Col ${cursor.col}`}</span>}
      <span className={item}>helenus dev</span>
    </footer>
  )
}
