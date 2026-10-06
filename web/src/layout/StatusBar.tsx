import { Lock, TriangleAlert } from 'lucide-react'
import { StatusDot } from '../ui/StatusDot'
import { JobsIndicator } from './JobsIndicator'
import { useCluster, useProfiles } from '../api/hooks'
import { useWorkspace } from '../store/workspace'
import { useMeta } from '../api/useAuth'
import { InsecureBindBadge } from './InsecureBindBadge'

/**
 * 24px footer: profile status, server version, datacenter and node count (from /cluster), TLS, a
 * persistent warning when certificate verification is off, consistency and cursor position.
 */
export function StatusBar() {
  const profileId = useWorkspace((s) => s.profileId)
  const conn = useWorkspace((s) => s.connections[s.profileId])
  const consistency = useWorkspace((s) => s.consistency)
  const cursor = useWorkspace((s) => s.cursor)
  const activeKind = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeId)?.kind)
  const { data: profiles = [] } = useProfiles()
  const { data: meta } = useMeta()
  const p = profiles.find((x) => x.name === profileId)
  const connected = conn?.status === 'connected'
  const { data: cluster } = useCluster(profileId, connected)
  const item = 'inline-flex h-5 items-center gap-[5px] rounded-[3px] px-1.5'
  const tls = p?.tls.enabled || !!p?.astra.secure_bundle
  return (
    <footer className="flex items-center gap-0.5 border-t border-line bg-titlebar px-1.5 text-xs text-muted">
      {p && (
        <span className={item}>
          <StatusDot status={conn?.status ?? 'idle'} />
          {p.name}
        </span>
      )}
      {connected && cluster && (
        <>
          <span className={item}>Cassandra {cluster.release_version}</span>
          <span className={item}>
            {cluster.local_dc} · {cluster.node_count} node{cluster.node_count === 1 ? '' : 's'}
          </span>
        </>
      )}
      {tls && (
        <span className={item}>
          <Lock size={12} aria-hidden />
          TLS
        </span>
      )}
      {p?.tls.enabled && p.tls.insecure_skip_verify && (
        <span className={`${item} text-warn`} title="Certificate verification is disabled for this profile">
          <TriangleAlert size={12} aria-hidden />
          Insecure TLS
        </span>
      )}
      {meta?.insecure_bind && <InsecureBindBadge className={item} />}
      {conn?.status === 'error' && conn.error && <span className={`${item} min-w-0 truncate text-danger`}>{conn.error}</span>}
      <div className="flex-1" />
      <JobsIndicator profile={profileId} enabled={connected} className={item} />
      <span className={item}>{consistency}</span>
      {activeKind === 'query' && <span className={item}>{`Ln ${cursor.line}, Col ${cursor.col}`}</span>}
      <span className={item}>helenus dev</span>
    </footer>
  )
}
