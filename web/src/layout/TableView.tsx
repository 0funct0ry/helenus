import { useMemo, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Tabs } from '../ui/Tabs'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { ResultsGrid } from './ResultsGrid'
import { SchemaSheet } from './SchemaSheet'
import { DdlView } from './DdlView'
import { ViewsSheet } from './ViewsSheet'
import { CountRowsDialog } from './CountRowsDialog'
import { usePagedSelect } from '../api/usePagedSelect'
import { rowToJson, toGridColumns, toGridRows } from '../lib/rows'
import { useDdl, useSchema } from '../api/hooks'
import { describeError } from '../api/client'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

export const CONSISTENCY_LEVELS = ['ANY', 'ONE', 'TWO', 'THREE', 'QUORUM', 'LOCAL_QUORUM', 'EACH_QUORUM', 'ALL', 'LOCAL_ONE'].map((v) => ({ value: v, label: v }))

export interface TableViewProps {
  /** The table or view tab being displayed. */
  tab: WorkspaceTab
}

/**
 * Table (or materialized view) tab body with Data, Schema, DDL and Views sub-views. Views are
 * read-only and have no Views sub-view. Everything comes from the connected cluster; Data runs a
 * read-only `SELECT *` with native paging (Previous/Next, page size, Count rows) at the tab's consistency.
 */
export function TableView({ tab }: TableViewProps) {
  const [sub, setSub] = useState('data')
  const consistency = useWorkspace((s) => s.consistency)
  const setConsistency = useWorkspace((s) => s.setConsistency)
  const open = useWorkspace((s) => s.open)
  const newQuery = useWorkspace((s) => s.newQuery)
  const profileId = useWorkspace((s) => s.profileId)
  const connected = useWorkspace((s) => s.connections[s.profileId]?.status === 'connected')
  const isView = tab.kind === 'view'
  const { data: keyspaces, isLoading } = useSchema(profileId, connected)
  const ks = keyspaces?.find((k) => k.name === tab.keyspace)
  const table = ks?.tables.find((t) => t.name === tab.object)
  const view = ks?.views.find((v) => v.name === tab.object)
  const columns = useMemo(() => table?.columns ?? view?.columns ?? [], [table, view])
  const views = useMemo(() => (table && ks ? ks.views.filter((v) => v.baseTable === table.name) : []), [table, ks])
  const [pageSize, setPageSize] = useState(100)
  const [counting, setCounting] = useState(false)
  const ident = (n: string) => (/^[a-z][a-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`)
  const data = usePagedSelect(profileId, tab.keyspace, `SELECT * FROM ${ident(tab.keyspace)}.${ident(tab.object)};`, consistency, pageSize, sub === 'data' && connected && !!(table || view))
  const dataColumns = useMemo(() => (data.response ? toGridColumns(data.response.columns) : columns), [data.response, columns])
  const dataRows = useMemo(() => (data.response ? toGridRows(data.response) : []), [data.response])
  const ddlQuery = useDdl(profileId, tab.keyspace, isView ? 'view' : 'table', tab.object, sub === 'ddl' && !!(table || view))

  const items = [
    { id: 'data', label: 'Data' },
    { id: 'schema', label: 'Schema' },
    { id: 'ddl', label: 'DDL' },
    ...(isView ? [] : [{ id: 'views', label: 'Views', badge: views.length }]),
  ]
  const pk = columns.filter((c) => c.kind === 'partition')

  if (!table && !view) {
    return <p className="p-6 text-muted">{isLoading ? 'Reading schema…' : `${tab.keyspace}.${tab.object} is not in the current schema. Refresh the schema if it was just created.`}</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-line2 px-2.5 py-[5px]">
        <Tabs aria-label="Table views" items={items} value={sub} onChange={setSub} />
        <div className="mx-1.5 h-4 w-px bg-line" />
        <span className="inline-flex h-6 items-center gap-2 overflow-hidden rounded border border-line bg-editor px-2 font-mono text-[12.5px]">
          <span className="font-sans text-muted">Partition</span>
          <span className="truncate">{pk.length ? pk.map((c) => `${c.name} = …`).join(' AND ') : 'all partitions'}</span>
        </span>
        <div className="flex-1" />
        <Button variant="ghost" icon={<Plus size={14} />} disabled title={isView ? 'Views are read-only' : 'Editing arrives in a later milestone'}>
          Insert row
        </Button>
        <Select label="Consistency" value={consistency} onChange={setConsistency} options={CONSISTENCY_LEVELS} />
        <IconButton label="Refresh" icon={<RefreshCw size={14} />} onClick={data.reload} />
      </div>
      {sub === 'data' && data.error && <p role="alert" className="m-3 rounded-md bg-err-bg px-3 py-2 text-[12.5px] text-danger">{data.error}</p>}
      {sub === 'data' && !data.error && !data.response && <p className="p-4 text-muted">{data.loading ? 'Reading rows…' : 'Connect to read rows.'}</p>}
      {sub === 'data' && !data.error && data.response && (
        <ResultsGrid
          columns={dataColumns}
          rows={dataRows}
          page={data.page}
          elapsedMs={data.response.timing.client_ms}
          consistency={consistency}
          hasPrev={data.page > 1}
          hasNext={data.response.has_more}
          onPrev={data.prev}
          onNext={data.next}
          pageSize={pageSize}
          onPageSize={setPageSize}
          showCount
          onCount={() => setCounting(true)}
          rowJson={(i) => rowToJson(data.response!, i)}
        />
      )}
      <CountRowsDialog open={counting} onClose={() => setCounting(false)} onRun={data.count} />
      {sub === 'schema' && <SchemaSheet columns={columns} options={table?.options} indexes={table?.indexes} />}
      {sub === 'ddl' && (
        <DdlView
          ddl={ddlQuery.isLoading ? 'Reading DDL…' : ddlQuery.error ? `-- ${describeError(ddlQuery.error)}` : (ddlQuery.data ?? '').trim()}
          source={`DESCRIBE ${isView ? 'MATERIALIZED VIEW' : 'TABLE'} ${tab.keyspace}.${tab.object}`}
          onOpenInQuery={() => newQuery({ keyspace: tab.keyspace, cql: ddlQuery.data?.trim() })}
        />
      )}
      {sub === 'views' && <ViewsSheet views={views} onOpen={(n) => open('view', tab.keyspace, n)} />}
    </div>
  )
}
