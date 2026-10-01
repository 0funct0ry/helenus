import { AlertTriangle, Info, XCircle } from 'lucide-react'
import type { Message } from '../mocks/types'

export interface MessagesViewProps {
  messages: Message[]
}

const styles = {
  info: { Icon: Info, box: 'bg-surface', icon: 'text-accent' },
  warning: { Icon: AlertTriangle, box: 'bg-warn-bg', icon: 'text-warn' },
  error: { Icon: XCircle, box: 'bg-err-bg', icon: 'text-danger' },
} as const

/** Messages panel: info, warning and error entries with optional monospace detail (e.g. the statement). */
export function MessagesView({ messages }: MessagesViewProps) {
  return (
    <div className="flex-1 overflow-auto px-4 py-3 text-[12.5px]">
      {messages.length === 0 && <p className="text-muted">No messages.</p>}
      {messages.map((m) => {
        const { Icon, box, icon } = styles[m.level]
        return (
          <div key={m.id} data-level={m.level} className={`mb-2 flex gap-2.5 rounded-md px-2.5 py-2 ${box}`}>
            <Icon size={14} className={`mt-0.5 shrink-0 ${icon}`} aria-hidden />
            <div>
              {m.text}
              {m.detail && <pre className="mb-0 mt-1.5 whitespace-pre-wrap font-mono text-xs">{m.detail}</pre>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
