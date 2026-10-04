import { Plus, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'

export interface DatacenterRow {
  name: string
  rf: number
}

export interface DatacenterRowsProps {
  rows: DatacenterRow[]
  /** Validation messages keyed by plan field (`datacenters.<i>.name`, `datacenters.<i>.rf`, `datacenters`). */
  errors: Record<string, string>
  onChange: (rows: DatacenterRow[]) => void
}

/**
 * The datacenter table of a NetworkTopologyStrategy keyspace: one row per datacenter with a name and a
 * replication factor, a remove button per row and an "Add datacenter" button. Row errors show under the row.
 */
export function DatacenterRows({ rows, errors, onChange }: DatacenterRowsProps) {
  const set = (i: number, patch: Partial<DatacenterRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div>
      <ul className="m-0 mb-2 flex list-none flex-col gap-2 p-0">
        {rows.map((r, i) => {
          const msgs = [errors[`datacenters.${i}.name`], errors[`datacenters.${i}.rf`]].filter(Boolean)
          return (
            <li key={i}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input mono aria-label={`Datacenter ${i + 1} name`} placeholder="datacenter name" value={r.name} invalid={!!errors[`datacenters.${i}.name`]} onChange={(e) => set(i, { name: e.target.value })} />
                </div>
                <div className="w-20 shrink-0">
                  <Input
                    type="number"
                    aria-label={`Datacenter ${i + 1} replication factor`}
                    value={Number.isNaN(r.rf) ? '' : r.rf}
                    invalid={!!errors[`datacenters.${i}.rf`]}
                    onChange={(e) => set(i, { rf: e.target.value === '' ? NaN : Number(e.target.value) })}
                  />
                </div>
                <IconButton label={`Remove datacenter ${i + 1}`} icon={<X size={13} />} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
              </div>
              {msgs.map((m) => (
                <p key={m} className="m-0 mt-1 text-xs text-danger">
                  {m}
                </p>
              ))}
            </li>
          )
        })}
      </ul>
      {errors.datacenters && <p className="m-0 mb-2 text-xs text-danger">{errors.datacenters}</p>}
      <Button variant="ghost" icon={<Plus size={13} />} onClick={() => onChange([...rows, { name: '', rf: 1 }])}>
        Add datacenter
      </Button>
    </div>
  )
}
