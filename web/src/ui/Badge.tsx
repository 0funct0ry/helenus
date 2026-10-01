import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export type BadgeTone = 'uuid' | 'num' | 'counter' | 'blob' | 'time' | 'coll' | 'udt' | 'vec' | 'text' | 'bool' | 'neutral'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Colour family; maps to the `--b-*` theme tokens. `neutral` is a bordered pill. */
  tone?: BadgeTone
}

const colour: Record<Exclude<BadgeTone, 'neutral'>, string> = {
  uuid: 'var(--b-uuid)',
  num: 'var(--b-num)',
  counter: 'var(--b-counter)',
  blob: 'var(--b-blob)',
  time: 'var(--b-time)',
  coll: 'var(--b-coll)',
  udt: 'var(--b-udt)',
  vec: 'var(--b-vec)',
  text: 'var(--b-text)',
  bool: 'var(--b-num)',
}

/** A compact monospace pill with a background tinted at 14% of its tone colour. */
export function Badge({ tone = 'neutral', className, style, children, ...rest }: BadgeProps) {
  if (tone === 'neutral') {
    return (
      <span className={cn('rounded-lg border border-line px-1.5 text-[11px] leading-[15px] text-muted', className)} style={style} {...rest}>
        {children}
      </span>
    )
  }
  const c = colour[tone]
  return (
    <span
      data-tone={tone}
      className={cn('inline-flex items-center gap-[3px] whitespace-nowrap rounded-[3px] px-[5px] font-mono text-[11px] font-medium leading-4', className)}
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, ...style }}
      {...rest}
    >
      {children}
    </span>
  )
}
