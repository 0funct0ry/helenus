import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { Tabs } from "../ui/Tabs";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { ResultsGrid } from "./ResultsGrid";
import { SchemaSheet } from "./SchemaSheet";
import { DropViewDialog } from "./DropViewDialog";
import { DdlView } from "./DdlView";
import { ViewsSheet } from "./ViewsSheet";
import { IndexesSheet } from "./IndexesSheet";
import { DependencyPanel } from "./DependencyPanel";
import { CountRowsDialog } from "./CountRowsDialog";
import { CellEditor } from "./CellEditor";
import { CollectionPopover } from "./CollectionPopover";
import { InsertRowDialog } from "./InsertRowDialog";
import { PendingBar } from "./PendingBar";
import { ReviewChangesDialog } from "./ReviewChangesDialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { usePagedSelect } from "../api/usePagedSelect";
import { useTableEditing } from "../api/useTableEditing";
import { rowToJson, toGridColumns, toGridRows } from "../lib/rows";
import { useCluster, useDdl, useRefreshSchema, useSchema } from "../api/hooks";
import { describeError } from "../api/client";
import { useWorkspace } from "../store/workspace";
import type { WorkspaceTab } from "../store/workspace";

export const CONSISTENCY_LEVELS = [
  "ANY",
  "ONE",
  "TWO",
  "THREE",
  "QUORUM",
  "LOCAL_QUORUM",
  "EACH_QUORUM",
  "ALL",
  "LOCAL_ONE",
].map((v) => ({ value: v, label: v }));

export interface TableViewProps {
  /** The table or view tab being displayed. */
  tab: WorkspaceTab;
}

/**
 * Table (or materialized view) tab body with Data, Schema, DDL and Views sub-views. Views have no Views
 * sub-view. Everything comes from the connected cluster; Data runs a `SELECT *` with native paging
 * (Previous/Next, page size, Count rows) at the tab's consistency. On a table the Data grid is a
 * spreadsheet (SPEC §9.9): edits are staged in a pending bar, reviewed as CQL, then applied. Materialized
 * views, system keyspaces and results without the full primary key stay read-only, with the reason shown.
 */
export function TableView({ tab }: TableViewProps) {
  const [sub, setSub] = useState("data");
  const [editSchema, setEditSchema] = useState(false);
  const [droppingView, setDroppingView] = useState(false);
  const closeTab = useWorkspace((s) => s.close);
  const consistency = useWorkspace((s) => s.consistency);
  const setConsistency = useWorkspace((s) => s.setConsistency);
  const open = useWorkspace((s) => s.open);
  const newQuery = useWorkspace((s) => s.newQuery);
  const profileId = useWorkspace((s) => s.profileId);
  const connected = useWorkspace(
    (s) => s.connections[s.profileId]?.status === "connected",
  );
  const isView = tab.kind === "view";
  const { data: keyspaces, isLoading } = useSchema(profileId, connected);
  const ks = keyspaces?.find((k) => k.name === tab.keyspace);
  const { data: cluster } = useCluster(profileId, connected);
  const refreshSchema = useRefreshSchema(profileId);
  const table = ks?.tables.find((t) => t.name === tab.object);
  const view = ks?.views.find((v) => v.name === tab.object);
  const columns = useMemo(
    () => table?.columns ?? view?.columns ?? [],
    [table, view],
  );
  const views = useMemo(
    () =>
      table && ks ? ks.views.filter((v) => v.baseTable === table.name) : [],
    [table, ks],
  );
  const [pageSize, setPageSize] = useState(100);
  const [counting, setCounting] = useState(false);
  const ident = (n: string) =>
    /^[a-z][a-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`;
  const data = usePagedSelect(
    profileId,
    tab.keyspace,
    `SELECT * FROM ${ident(tab.keyspace)}.${ident(tab.object)};`,
    consistency,
    pageSize,
    sub === "data" && connected && !!(table || view),
  );
  const editing = useTableEditing({
    tab,
    profile: profileId,
    consistency,
    response: data.response,
    refetch: data.refetch,
    tableColumns: columns,
    isView,
    system: !!ks?.system,
    counterTable: !!table?.counter,
    keyspaces,
  });
  const dataEpoch = useWorkspace((s) => s.dataEpoch);
  const lastEpoch = useRef(dataEpoch);
  useEffect(() => {
    if (lastEpoch.current === dataEpoch) return;
    lastEpoch.current = dataEpoch;
    data.reload();
  }, [dataEpoch, data]);
  const dataColumns = useMemo(
    () => (data.response ? toGridColumns(data.response.columns) : columns),
    [data.response, columns],
  );
  const dataRows = useMemo(
    () => (data.response ? toGridRows(data.response) : []),
    [data.response],
  );
  const shownRows = editing.composed?.rows ?? dataRows;
  const ddlQuery = useDdl(
    profileId,
    tab.keyspace,
    isView ? "view" : "table",
    tab.object,
    sub === "ddl" && !!(table || view),
  );

  const items = [
    { id: "data", label: "Data" },
    { id: "schema", label: "Schema" },
    { id: "ddl", label: "DDL" },
    { id: "deps", label: "Dependencies" },
    ...(isView || !table
      ? []
      : [{ id: "indexes", label: "Indexes", badge: table.indexes.length }]),
    ...(isView ? [] : [{ id: "views", label: "Views", badge: views.length }]),
  ];
  const pk = columns.filter((c) => c.kind === "partition");

  if (!table && !view) {
    return (
      <p className="p-6 text-muted">
        {isLoading
          ? "Reading schema…"
          : `${tab.keyspace}.${tab.object} is not in the current schema. Refresh the schema if it was just created.`}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-line2 px-2.5 py-[5px]">
        <Tabs
          aria-label="Table views"
          items={items}
          value={sub}
          onChange={setSub}
        />
        <div className="mx-1.5 h-4 w-px bg-line" />
        <span className="inline-flex h-6 items-center gap-2 overflow-hidden rounded border border-line bg-editor px-2 font-mono text-[12.5px]">
          <span className="font-sans text-muted">Partition</span>
          <span className="truncate">
            {pk.length
              ? pk.map((c) => `${c.name} = …`).join(" AND ")
              : "all partitions"}
          </span>
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          icon={<Plus size={14} />}
          disabled={!editing.toolbar.canInsert}
          title={editing.toolbar.insertTitle}
          onClick={editing.toolbar.onInsert}
        >
          Insert row
        </Button>
        {editing.ed.editable && !table?.counter && (
          <>
            <Button
              variant="ghost"
              icon={<Copy size={14} />}
              disabled={!editing.toolbar.canDuplicate}
              title="Insert a copy of the selected row with a new key"
              onClick={editing.toolbar.onDuplicate}
            >
              Duplicate row
            </Button>
            <Button
              variant="ghost"
              icon={
                editing.toolbar.deleteLabel === "Delete row" ? (
                  <Trash2 size={14} />
                ) : (
                  <Undo2 size={14} />
                )
              }
              disabled={!editing.toolbar.canDelete}
              title="Select a row first"
              onClick={editing.toolbar.onDelete}
            >
              {editing.toolbar.deleteLabel}
            </Button>
          </>
        )}
        <Select
          label="Consistency"
          value={consistency}
          onChange={setConsistency}
          options={CONSISTENCY_LEVELS}
        />
        <IconButton
          label="Refresh"
          icon={<RefreshCw size={14} />}
          onClick={data.reload}
        />
      </div>
      {sub === "data" && !editing.ed.editable && editing.ed.reason && (
        <p className="m-0 border-b border-line2 px-3 py-1.5 text-xs text-muted">
          {editing.ed.reason}
        </p>
      )}
      {sub === "data" && editing.editError && (
        <p
          role="alert"
          className="m-0 border-b border-line2 bg-err-bg px-3 py-1.5 text-xs text-danger"
        >
          {editing.editError}
        </p>
      )}
      {sub === "data" && data.error && (
        <p
          role="alert"
          className="m-3 rounded-md bg-err-bg px-3 py-2 text-[12.5px] text-danger"
        >
          {data.error}
        </p>
      )}
      {sub === "data" && !data.error && !data.response && (
        <p className="p-4 text-muted">
          {data.loading ? "Reading rows…" : "Connect to read rows."}
        </p>
      )}
      {sub === "data" && !data.error && data.response && (
        <ResultsGrid
          columns={dataColumns}
          rows={shownRows}
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
          rowJson={(i) => {
            const src = editing.composed?.meta[i]?.source;
            return src === null
              ? JSON.stringify(shownRows[i], null, 2)
              : rowToJson(data.response!, src ?? i);
          }}
          edit={
            editing.grid && {
              ...editing.grid,
              renderEditor: (row, column) => {
                const ed = editing.editorFor(row, column.name);
                if (!ed) return null;
                return (
                  <CellEditor
                    name={ed.qcol.name}
                    type={ed.qcol.type}
                    initial={ed.initial}
                    counter={ed.qcol.type.name === "counter"}
                    onCommit={(r) => editing.commitCell(row, column.name, r)}
                    onCancel={editing.cancelEdit}
                    onInvalid={editing.setEditError}
                  />
                );
              },
            }
          }
        />
      )}
      {sub === "data" && (
        <PendingBar
          items={editing.items}
          failure={editing.failure}
          busy={editing.busy}
          onDiscard={() => editing.setDiscarding(true)}
          onReview={() => editing.setReviewing(true)}
          onApply={() => void editing.apply()}
        />
      )}
      {editing.collection && (
        <CollectionPopover
          open
          onClose={editing.collection.onClose}
          anchorRef={editing.collection.anchorRef}
          name={editing.collection.name}
          type={editing.collection.type}
          original={editing.collection.original}
          draft={editing.collection.draft}
          udtFields={editing.udtFields}
          onStage={editing.collection.onStage}
        />
      )}
      <InsertRowDialog
        open={!!editing.inserting}
        onClose={editing.closeInsert}
        columns={data.response?.columns ?? []}
        initial={editing.inserting?.initial}
        duplicate={editing.inserting?.duplicate}
        udtFields={editing.udtFields}
        onStage={editing.stageInsert}
      />
      <ReviewChangesDialog
        open={editing.reviewing}
        onClose={() => editing.setReviewing(false)}
        profile={profileId}
        keyspace={tab.keyspace}
        table={tab.object}
        consistency={consistency}
        items={editing.items}
        onApplied={editing.handleApplied}
        onDropFailed={editing.dropFailed}
      />
      <ConfirmDialog
        open={editing.discarding}
        title="Discard pending changes"
        message={`Discard ${editing.items.length} pending ${editing.items.length === 1 ? "change" : "changes"}? Nothing has been written to the cluster.`}
        confirmLabel="Discard"
        danger
        onConfirm={editing.discard}
        onCancel={() => editing.setDiscarding(false)}
      />
      <CountRowsDialog
        open={counting}
        onClose={() => setCounting(false)}
        onRun={data.count}
      />
      {sub === "schema" && !ks?.system && (
        <div className="flex flex-none items-center gap-1 border-b border-line2 px-3 py-1">
          <Button
            variant="ghost"
            aria-pressed={editSchema}
            onClick={() => setEditSchema(!editSchema)}
          >
            {editSchema
              ? "Done editing"
              : isView
                ? "Edit options"
                : "Edit"}
          </Button>
          {isView && view && (
            <Button variant="ghost" onClick={() => setDroppingView(true)}>
              Drop view…
            </Button>
          )}
        </div>
      )}
      {sub === "schema" && (
        <SchemaSheet
          columns={columns}
          options={table?.options ?? view?.options}
          indexes={table?.indexes}
          edit={
            editSchema && (table || view) && !ks?.system
              ? {
                  keyspace: tab.keyspace,
                  table: tab.object,
                  view: isView || undefined,
                  udts: ks?.types.map((u) => u.name) ?? [],
                  serverMajor:
                    parseInt(cluster?.release_version ?? "0", 10) || 0,
                  onChanged: () => refreshSchema.mutate(),
                }
              : undefined
          }
        />
      )}
      {sub === "ddl" && (
        <DdlView
          ddl={
            ddlQuery.isLoading
              ? "Reading DDL…"
              : ddlQuery.error
                ? `-- ${describeError(ddlQuery.error)}`
                : (ddlQuery.data ?? "").trim()
          }
          source={`DESCRIBE ${isView ? "MATERIALIZED VIEW" : "TABLE"} ${tab.keyspace}.${tab.object}`}
          onOpenInQuery={() =>
            newQuery({ keyspace: tab.keyspace, cql: ddlQuery.data?.trim() })
          }
        />
      )}
      {droppingView && (
        <DropViewDialog
          keyspace={tab.keyspace}
          view={tab.object}
          onDropped={() => {
            closeTab(tab.id);
            refreshSchema.mutate();
          }}
          onClose={() => setDroppingView(false)}
        />
      )}
      {sub === "deps" && (
        <DependencyPanel
          kind={isView ? "view" : "table"}
          keyspace={tab.keyspace}
          name={tab.object}
        />
      )}
      {sub === "indexes" && table && (
        <IndexesSheet
          table={table}
          serverMajor={parseInt(cluster?.release_version ?? "0", 10) || 0}
          readOnly={!!ks?.system}
          onChanged={() => refreshSchema.mutate()}
        />
      )}
      {sub === "views" && (
        <ViewsSheet
          views={views}
          onOpen={(n) => open("view", tab.keyspace, n)}
        />
      )}
    </div>
  );
}
