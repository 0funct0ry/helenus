import type { InputHTMLAttributes, Ref } from 'react'
import { cn } from '../lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Use the monospace font. */
  mono?: boolean
  /** Outline the input as invalid (also sets aria-invalid). */
  invalid?: boolean
  ref?: Ref<HTMLInputElement>
}

/**
 * A bare 28px text input for dense places (cell editors, collection rows). It has no label of its own,
 * so callers must pass `aria-label`. Use Field when a visible label is wanted.
 */
export function Input({ mono, invalid, className, ref, ...rest }: InputProps) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-7 w-full min-w-0 rounded border bg-editor px-2 placeholder:text-faint focus:border-focus disabled:opacity-60',
        invalid ? 'border-danger' : 'border-line',
        mono && 'font-mono text-[12.5px]',
        className,
      )}
      {...rest}
    />
  )
}
