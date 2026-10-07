import { Copy, MousePointerClick, CopyPlus, PanelRight, Plus, Sigma, Trash2 } from 'lucide-react'
import type { RowFormat } from '../api/types'
import { ROW_FORMATS } from '../lib/copyRows'
import { SchemaContextMenu } from './SchemaContextMenu'
import type { ContextMenuItem } from './SchemaContextMenu'

export interface GridContextMenuProps {
  /** Viewport position of the pointer. */
  x: number
  y: number
  /** How many rows the menu acts on; drives the header and the plural labels. */
  count: number
  /** Why Add / Clone / Delete are unavailable, or null when editing is on. */
  editDisabledReason: string | null
  /** Why a Copy As format is unavailable, or null. */
  formatReason: (format: RowFormat) => string | null
  /** Set when the menu was opened on a row-number cell: adds "Select row" as the first item. */
  onSelectRow?: () => void
  onAdd: () => void
  onClone: () => void
  onDelete: () => void
  onCopyAs: (format: RowFormat) => void
  onRecordView: () => void
  onAggregateView: () => void
  onClose: () => void
}

/**
 * The results grid's row menu: Select row (only from a row-number cell) · Add row · Clone row · Delete row | Copy As ▸ (ten formats) | Show record
 * view · Show aggregate view. The header shows how many rows it acts on ("3 rows") and the labels pluralise.
 * Add, Clone and Delete only stage changes, and are disabled with a reason when editing is off; Copy As
 * formats that need a single source table are disabled with a reason as well.
 */
export function GridContextMenu({ x, y, count, editDisabledReason, formatReason, onSelectRow, onAdd, onClone, onDelete, onCopyAs, onRecordView, onAggregateView, onClose }: GridContextMenuProps) {
  const plural = count > 1
  const edit = { disabled: editDisabledReason !== null, disabledReason: editDisabledReason ?? undefined }
  const items: ContextMenuItem[] = [
    ...(onSelectRow ? [{ label: 'Select row', icon: <MousePointerClick size={13} />, onSelect: onSelectRow }] : []),
    { label: 'Add row', icon: <Plus size={13} />, onSelect: onAdd, ...edit },
    { label: plural ? `Clone ${count} rows` : 'Clone row', icon: <CopyPlus size={13} />, onSelect: onClone, ...edit },
    { label: plural ? `Delete ${count} rows` : 'Delete row', icon: <Trash2 size={13} />, onSelect: onDelete, danger: true, ...edit },
    {
      label: 'Copy As',
      icon: <Copy size={13} />,
      separatorBefore: true,
      children: ROW_FORMATS.map(({ format, label }) => {
        const reason = formatReason(format)
        return { label, onSelect: () => onCopyAs(format), disabled: reason !== null, disabledReason: reason ?? undefined }
      }),
    },
    { label: 'Show record view', icon: <PanelRight size={13} />, onSelect: onRecordView, separatorBefore: true },
    { label: 'Show aggregate view', icon: <Sigma size={13} />, onSelect: onAggregateView },
  ]
  return <SchemaContextMenu x={x} y={y} label="Row actions" header={`${count} ${plural ? 'rows' : 'row'}`} items={items} onClose={onClose} />
}
