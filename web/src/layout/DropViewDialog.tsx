import { useState } from 'react'
import { Field } from '../ui/Field'
import { TableActionDialog } from './TableActionDialog'

export interface DropViewDialogProps {
  keyspace: string
  view: string
  /** Called after the view was dropped. */
  onDropped: () => void
  onClose: () => void
}

/** Drop confirmation for a materialized view; the exact view name must be typed first. */
export function DropViewDialog({ keyspace, view, onDropped, onClose }: DropViewDialogProps) {
  const [typed, setTyped] = useState('')
  return (
    <TableActionDialog
      title="Drop view"
      subtitle={`${keyspace}.${view}`}
      request={{ action: 'drop_view', keyspace, name: view }}
      applyLabel="Drop view"
      danger
      confirmed={typed === view}
      onApplied={onDropped}
      onClose={onClose}
    >
      <p className="mt-0 text-[13px]">Dropping a view deletes its data; the base table is not touched. Type the view name to confirm.</p>
      <Field label={`Type "${view}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
    </TableActionDialog>
  )
}
