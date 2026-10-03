import { typeFamily } from '../lib/typeFamily'
import { timeuuidTime } from '../lib/cellFormat'
import type { CellValue, Column } from '../mocks/types'

export interface GridCellProps {
  column: Column
  /** The display text of the value; null renders as a dim italic "null". */
  value: CellValue
}

/**
 * The content of one results-grid cell, coloured by type family. Key columns are muted, timeuuid values
 * carry their embedded time as a tooltip, and null is a dim italic "null".
 */
export function GridCell({ column, value }: GridCellProps) {
  if (value === null) return <span className="italic text-dim">null</span>
  const f = typeFamily(column.type)
  if (column.type === 'timeuuid') {
    const when = timeuuidTime(String(value))
    return <span className={column.kind === 'regular' ? 'text-syn-str' : 'text-muted'} title={when}>{String(value)}</span>
  }
  if (column.kind === 'partition' || column.kind === 'clustering') return <span className="text-muted">{String(value)}</span>
  if (f === 'num' || f === 'counter') return <span className="text-syn-num">{String(value)}</span>
  if (f === 'coll' || f === 'udt' || f === 'vec') return <span className="text-syn-const">{String(value)}</span>
  return <span className="text-syn-str">{String(value)}</span>
}
