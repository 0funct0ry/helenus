import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style; `primary` uses the accent colour, `danger` tints the label red. */
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  /** Optional leading icon element. */
  icon?: ReactNode
  /** Optional keyboard hint shown at the end of the label (e.g. "⌘↵"). */
  kbd?: string
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'border-line bg-elevated hover:bg-hover',
  primary: 'border-accent bg-accent text-on-accent hover:brightness-110',
  ghost: 'border-transparent bg-transparent hover:bg-hover',
  danger: 'border-transparent bg-transparent text-danger hover:bg-hover',
}

/** A compact 24px-high text button with optional icon and keyboard hint. Defaults to type="button". */
export function Button({ variant = 'default', icon, kbd, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded border px-2 disabled:opacity-50 disabled:hover:bg-transparent',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {kbd && <span className="font-mono text-[11px] opacity-75">{kbd}</span>}
    </button>
  )
}
