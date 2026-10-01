import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** Current state. */
  checked: boolean
  /** Called with the next state on click or Space/Enter. */
  onChange: (checked: boolean) => void
}

/** A switch (role="switch") with a sliding knob and a text label given as children. */
export function Toggle({ checked, onChange, className, children, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex h-6 items-center gap-1.5 rounded px-1.5 hover:bg-hover', checked ? 'text-fg' : 'text-muted', className)}
      {...rest}
    >
      <span className={cn('relative h-3.5 w-6 rounded-[7px] transition-colors', checked ? 'bg-accent' : 'bg-selected')}>
        <span
          className={cn('absolute left-0.5 top-0.5 size-2.5 rounded-full transition-transform', checked ? 'translate-x-2.5 bg-white' : 'bg-muted')}
        />
      </span>
      {children}
    </button>
  )
}
