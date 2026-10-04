import { X } from 'lucide-react'
import { useToasts } from '../store/toast'
import { IconButton } from './IconButton'

/**
 * Renders the messages queued with `useToasts().push` in a polite live region at the bottom right of the
 * window. Each toast has a dismiss button and also closes itself after a few seconds.
 */
export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-8 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-elevated py-1.5 pl-3 pr-1.5 text-[12.5px] shadow-lg">
          <span>{t.message}</span>
          <IconButton label="Dismiss" icon={<X size={13} />} onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  )
}
