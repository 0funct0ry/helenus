import { TriangleAlert } from 'lucide-react'

export interface InsecureBindBadgeProps {
  className?: string
}

/** Status-bar warning that the server is reachable from the network over plain HTTP. */
export function InsecureBindBadge({ className }: InsecureBindBadgeProps) {
  return (
    <span className={`${className ?? ''} text-warn`} title="This server is reachable from the network without TLS. Passwords and sessions can be intercepted. Start it with --tls-cert and --tls-key.">
      <TriangleAlert size={12} aria-hidden />
      Not secure: plain HTTP on the network
    </span>
  )
}
