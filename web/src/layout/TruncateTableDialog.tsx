import { useState } from 'react'
import { Field } from '../ui/Field'
import { TableActionDialog } from './TableActionDialog'

export interface TruncateTableDialogProps {
  keyspace: string
  table: string
  /** Called after the table was truncated. */
  onTruncated: () => void
  onClose: () => void
}

/**
 * Truncate confirmation. The row count is not known up front, so the dialog says so; the user must type the
 * exact table name before "Truncate" is enabled. The statement and its notes come from the server.
 */
export function TruncateTableDialog({ keyspace, table, onTruncated, onClose }: TruncateTableDialogProps) {
  const [typed, setTyped] = useState('')
  return (
    <TableActionDialog
      title="Truncate table"
      subtitle={`${keyspace}.${table}`}
      request={{ action: 'truncate', keyspace, name: table }}
      applyLabel="Truncate"
      danger
      confirmed={typed === table}
      onApplied={onTruncated}
      onClose={onClose}
    >
      <p className="mt-0 text-[13px]">Truncating deletes every row in the table and cannot be undone. The number of rows is unknown. Type the table name to confirm.</p>
      <Field label={`Type "${table}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
    </TableActionDialog>
  )
}
