import { Eye, Info } from 'lucide-react'
import { Button } from '../ui/Button'
import type { MaterializedView } from '../lib/schemaModel'

export interface ViewsSheetProps {
  views: MaterializedView[]
  onOpen: (name: string) => void
}

/** The Views sub-view: lists materialized views on a table with their key layout and an Open action. */
export function ViewsSheet({ views, onOpen }: ViewsSheetProps) {
  const list = (v: MaterializedView, kind: 'partition' | 'clustering') =>
    v.columns.filter((c) => c.kind === kind).map((c) => (kind === 'clustering' && c.order === 'DESC' ? `${c.name} DESC` : c.name)).join(', ')
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px]">
        <h3 className="mb-2 mt-0 text-[13px] font-semibold">Materialized views on this table</h3>
        {views.length === 0 ? (
          <p className="text-muted">This table has no materialized views.</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['View', 'Partition key', 'Clustering', 'Filter', ''].map((h) => (
                  <th key={h} className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {views.map((v) => (
                <tr key={v.name}>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono">
                    <Eye size={12} className="mr-1 inline text-muted" aria-hidden />
                    {v.name}
                  </td>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{list(v, 'partition')}</td>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{list(v, 'clustering')}</td>
                  <td className="border-b border-line2 px-2.5 py-1.5 font-mono text-muted">{v.filter}</td>
                  <td className="border-b border-line2 px-2.5 py-1.5">
                    <Button variant="ghost" onClick={() => onOpen(v.name)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-2.5 flex gap-2 rounded-md bg-surface px-2.5 py-2 text-[12.5px] text-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          Views are read-only in Helenus. Edit rows in the base table and Cassandra updates the view.
        </div>
      </div>
    </div>
  )
}
