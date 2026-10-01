import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also used as the native tooltip. Required because there is no visible text. */
  label: string
  /** The icon to display. */
  icon: ReactNode
}

/** A 22px square icon-only button. `label` becomes aria-label and title. */
export function IconButton({ label, icon, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn('grid size-[22px] shrink-0 place-items-center rounded text-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent', className)}
      {...rest}
    >
      {icon}
    </button>
  )
}
