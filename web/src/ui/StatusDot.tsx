import type { ProfileStatus } from '../mocks/types'

type Status = ProfileStatus | 'idle'

export interface StatusDotProps {
  /** Connection state: connected is green, connecting is amber, error is red, idle (not connected yet) is grey. */
  status: Status
}

const colour: Record<Status, string> = {
  idle: 'bg-faint',
  connected: 'bg-ok',
  connecting: 'bg-warn',
  error: 'bg-danger',
}

/** A 7px status dot with an accessible text label (`role="img"`). */
export function StatusDot({ status }: StatusDotProps) {
  return <span role="img" aria-label={status} data-status={status} className={`inline-block size-[7px] shrink-0 rounded-full ${colour[status]}`} />
}
