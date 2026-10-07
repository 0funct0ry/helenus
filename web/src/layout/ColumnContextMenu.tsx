import { ArrowDown, ArrowUp, Copy, CopyCheck, EyeOff, Eye, Filter, ListX, MousePointerClick } from 'lucide-react'
import type { RowFormat } from '../api/types'
import { COLUMN_FORMATS } from '../lib/copyRows'
import { SchemaContextMenu } from './SchemaContextMenu'
import type { ContextMenuItem } from './SchemaContextMenu'

export interface ColumnContextMenuProps {
  /** Viewport position of the pointer. */
  x: number
  y: number
  /** Names of the columns the menu acts on, in grid order. */
  targets: string[]
  /** Why Sort ascending/descending are unavailable for the right-clicked column, or null. */
  sortReason: string | null
  /** A sort is active, so Clear sorting is enabled. */
  sorted: boolean
  /** The targets already equal the current column selection, so Select Column is disabled. */
  alreadySelected: boolean
  /** Why Hide column is unavailable (it would hide everything), or null. */
  hideReason: string | null
  /** At least one column is hidden, so Show All Columns is enabled. */
  anyHidden: boolean
  /** Why Copy Column as is unavailable (no wire data behind the grid), or null. */
  copyReason: string | null
  onCopyNames: () => void
  onSelect: () => void
  onSort: (dir: 'asc' | 'desc') => void
  onClearSort: () => void
  onFilter: () => void
  onCopyAs: (format: RowFormat) => void
  onHide: () => void
  onShowAll: () => void
  onClose: () => void
}

/**
 * The results grid's column header menu: Copy Column Name · Select Column | Sort ascending · Sort descending · Clear sorting |
 * Set local filter | Copy Column as ▸ (eight formats) | Hide column · Show All Columns. The header shows the column name, or
 * "3 columns", and labels pluralise. Sort and filter always act on the right-clicked column (the first target when it
 * is the only one); the rest act on every target.
 */
export function ColumnContextMenu({ x, y, targets, sortReason, sorted, alreadySelected, hideReason, anyHidden, copyReason, onCopyNames, onSelect, onSort, onClearSort, onFilter, onCopyAs, onHide, onShowAll, onClose }: ColumnContextMenuProps) {
  const n = targets.length
  const plural = n > 1
  const sort = { disabled: sortReason !== null, disabledReason: sortReason ?? undefined }
  const items: ContextMenuItem[] = [
    { label: plural ? 'Copy Column Names' : 'Copy Column Name', icon: <Copy size={13} />, onSelect: onCopyNames },
    { label: plural ? 'Select Columns' : 'Select Column', icon: <MousePointerClick size={13} />, onSelect, disabled: alreadySelected, disabledReason: alreadySelected ? 'Already selected' : undefined },
    { label: 'Sort ascending', icon: <ArrowUp size={13} />, onSelect: () => onSort('asc'), separatorBefore: true, ...sort },
    { label: 'Sort descending', icon: <ArrowDown size={13} />, onSelect: () => onSort('desc'), ...sort },
    { label: 'Clear sorting', icon: <ListX size={13} />, onSelect: onClearSort, disabled: !sorted, disabledReason: sorted ? undefined : 'No sort is active' },
    { label: 'Set local filter', icon: <Filter size={13} />, onSelect: onFilter, separatorBefore: true },
    {
      label: 'Copy Column as',
      icon: <CopyCheck size={13} />,
      separatorBefore: true,
      disabled: copyReason !== null,
      disabledReason: copyReason ?? undefined,
      children: COLUMN_FORMATS.map(({ format, label }) => ({ label, onSelect: () => onCopyAs(format) })),
    },
    { label: plural ? `Hide ${n} columns` : 'Hide column', icon: <EyeOff size={13} />, onSelect: onHide, separatorBefore: true, disabled: hideReason !== null, disabledReason: hideReason ?? undefined },
    { label: 'Show All Columns', icon: <Eye size={13} />, onSelect: onShowAll, disabled: !anyHidden, disabledReason: anyHidden ? undefined : 'No column is hidden' },
  ]
  return <SchemaContextMenu x={x} y={y} label="Column actions" header={plural ? `${n} columns` : targets[0]} items={items} onClose={onClose} />
}
