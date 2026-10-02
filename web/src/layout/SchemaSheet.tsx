import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import type { Column, Index } from '../lib/schemaModel'

export interface SchemaSheetProps {
  columns: Column[]
  options?: Record<string, string>
  indexes?: Index[]
}

/** The Schema sub-view: primary key layout, column table, table options and indexes. */
export function SchemaSheet({ columns, options = {}, indexes = [] }: SchemaSheetProps) {
  const pk = columns.filter((c) => c.kind === 'partition')
  const ck = columns.filter((c) => c.kind === 'clustering')
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="max-w-[1100px] px-[22px] pb-10 pt-[18px]">
        <h3 className="mb-2 mt-0 text-[13px] font-semibold">Primary key</h3>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line2 bg-surface px-3 py-2.5 font-mono text-[12.5px]">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-xs text-muted">Partition key</span>
            {pk.map((c) => (
              <span key={c.name} className="flex items-center gap-1.5">
                <KeyMarker kind="partition" position={c.position} />
                {c.name}
              </span>
            ))}
          </div>
          {ck.length > 0 && (
            <>
              <div className="h-4 w-px bg-line" />
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-xs text-muted">Clustering</span>
                {ck.map((c) => (
                  <span key={c.name} className="flex items-center gap-1.5">
                    <KeyMarker kind="clustering" position={c.position} order={c.order} />
                    {c.name}
                    <span className="font-sans text-xs text-muted">{c.order}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Columns</h3>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {['Key', 'Name', 'Type'].map((h) => (
                <th key={h} className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.name}>
                <td className="w-24 border-b border-line2 px-2.5 py-1.5">
                  <KeyMarker kind={c.kind} position={c.position} order={c.order} />
                </td>
                <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{c.name}</td>
                <td className="border-b border-line2 px-2.5 py-1.5">
                  <TypeBadge type={c.type} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {Object.keys(options).length > 0 && (
          <>
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Table options</h3>
            <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-px overflow-hidden rounded-md border border-line2 bg-line2">
              {Object.entries(options).map(([k, v]) => (
                <div key={k} className="bg-editor px-3 py-2">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="m-0 break-words font-mono text-xs">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {indexes.length > 0 && (
          <>
            <h3 className="mb-2 mt-[22px] text-[13px] font-semibold">Indexes</h3>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Name', 'Column', 'Kind'].map((h) => (
                    <th key={h} className="border-b border-line bg-surface px-2.5 py-1.5 text-left font-medium text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {indexes.map((i) => (
                  <tr key={i.name}>
                    <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{i.name}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5 font-mono">{i.column}</td>
                    <td className="border-b border-line2 px-2.5 py-1.5">{i.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
