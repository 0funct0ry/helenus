import { cn } from '../lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group. */
  label: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}

/** A single-choice control shown as joined buttons (role="radiogroup"); arrow keys move the choice. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  const move = (i: number, d: number) => onChange(options[(i + d + options.length) % options.length].value)
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-line bg-editor p-0.5">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              move(i, 1)
              ;(e.currentTarget.parentElement?.children[(i + 1) % options.length] as HTMLElement | undefined)?.focus()
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              move(i, -1)
              ;(e.currentTarget.parentElement?.children[(i - 1 + options.length) % options.length] as HTMLElement | undefined)?.focus()
            }
          }}
          className={cn('h-6 rounded px-2.5 text-[12.5px]', o.value === value ? 'bg-selected text-fg' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
