import { useState } from 'react'
import { Field } from '../ui/Field'
import { TableActionDialog } from './TableActionDialog'

export interface RenameColumnDialogProps {
  keyspace: string
  table: string
  column: string
  onRenamed: () => void
  onClose: () => void
}

/** Asks for the new name of a primary key column and previews the RENAME statement. */
export function RenameColumnDialog({ keyspace, table, column, onRenamed, onClose }: RenameColumnDialogProps) {
  const [to, setTo] = useState('')
  return (
    <TableActionDialog
      title="Rename column"
      subtitle={`${keyspace}.${table}.${column}`}
      request={{ action: 'rename_column', keyspace, name: table, from: column, to }}
      applyLabel="Rename"
      confirmed={to !== ''}
      onApplied={onRenamed}
      onClose={onClose}
    >
      <Field label="New name" mono value={to} autoFocus onChange={(e) => setTo(e.target.value)} />
    </TableActionDialog>
  )
}
