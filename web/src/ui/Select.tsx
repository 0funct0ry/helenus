import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './Popover'
import { cn } from '../lib/cn'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Small muted text before the value (e.g. "Consistency"). Also part of the accessible name. */
  label?: string
  /** Use the monospace font for the value. */
  mono?: boolean
  /** Accessible name when no visible `label` is given. */
  'aria-label'?: string
  className?: string
}

/**
 * A custom dropdown (never a native select). The trigger is a button; the options render in a
 * Popover listbox. Keyboard: Enter/Space/ArrowDown open, arrows move, Enter picks, Escape closes.
 */
export function Select({ value, options, onChange, label, mono, className, ...rest }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const current = options.find((o) => o.value === value)

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    ref.current?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(options[active].value)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest['aria-label'] ?? (label ? `${label}: ${current?.label ?? ''}` : undefined)}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        className={cn('inline-flex h-6 items-center gap-1.5 rounded border border-line bg-editor pl-2 pr-1.5 hover:bg-hover', mono && 'font-mono', className)}
      >
        {label && <span className="font-sans text-muted">{label}</span>}
        {current?.label ?? value}
        <ChevronDown size={12} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} role="presentation" matchWidth className="p-1">
        <ul id={listId} role="listbox" aria-label={rest['aria-label'] ?? label} onKeyDown={onKey} className="max-h-64 overflow-auto outline-none">
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
              className={cn('flex h-6 cursor-default items-center gap-2 whitespace-nowrap rounded px-2', mono && 'font-mono', i === active && 'bg-selected')}
            >
              <span className="w-3">{o.value === value && <Check size={12} />}</span>
              {o.label}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  )
}
