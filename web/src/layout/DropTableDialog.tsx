import { useState } from 'react'
import { Field } from '../ui/Field'
import { TableActionDialog } from './TableActionDialog'

export interface DropTableDialogProps {
  keyspace: string
  table: string
  /** Names of materialized views built on the table; any of them blocks the drop. */
  views: string[]
  /** Called after the table was dropped. */
  onDropped: () => void
  onClose: () => void
}

/**
 * Drop confirmation for a table. While materialized views depend on it the dialog names them (the server
 * also refuses); otherwise the exact table name must be typed before "Drop table" is enabled.
 */
export function DropTableDialog({ keyspace, table, views, onDropped, onClose }: DropTableDialogProps) {
  const [typed, setTyped] = useState('')
  const blocked = views.length > 0
  return (
    <TableActionDialog
      title="Drop table"
      subtitle={`${keyspace}.${table}`}
      request={{ action: 'drop', keyspace, name: table }}
      applyLabel="Drop table"
      danger
      confirmed={!blocked && typed === table}
      onApplied={onDropped}
      onClose={onClose}
    >
      {blocked ? (
        <>
          <p className="mt-0 text-[13px]">This table cannot be dropped while views depend on it. Drop these first:</p>
          <ul className="m-0 mb-3 list-none p-0 font-mono text-[12.5px]">
            {views.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-0 text-[13px]">Dropping a table deletes its data and cannot be undone. Type the table name to confirm.</p>
          <Field label={`Type "${table}" to confirm`} mono value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
        </>
      )}
    </TableActionDialog>
  )
}
