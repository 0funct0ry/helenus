import { Snowflake } from 'lucide-react'
import { Badge } from './Badge'
import { isFrozen, typeFamily } from '../lib/typeFamily'

export interface TypeBadgeProps {
  /** Full CQL type text, e.g. `frozen<address>` or `map<text, text>`. */
  type: string
}

/**
 * Pill showing a CQL type, coloured by family (uuid blue, numeric orange, counter purple, blob grey,
 * temporal teal, collections yellow, UDT green, vector pink). Frozen types get a snowflake glyph.
 */
export function TypeBadge({ type }: TypeBadgeProps) {
  const family = typeFamily(type)
  return (
    <Badge tone={family} data-family={family} data-frozen={isFrozen(type) || undefined} title={type}>
      {isFrozen(type) && <Snowflake size={11} aria-label="frozen" />}
      {type}
    </Badge>
  )
}
