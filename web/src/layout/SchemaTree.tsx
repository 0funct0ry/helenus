import { useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import {
  Braces,
  Copy,
  EllipsisVertical,
  Database,
  Hash,
  Layers,
  ExternalLink,
  Eye,
  FileText,
  FolderPlus,
  FunctionSquare,
  Lock,
  Zap,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
} from "lucide-react";
import { TreeRow } from "./TreeRow";
import { SchemaContextMenu } from "./SchemaContextMenu";
import { NewTypeDialog } from "./NewTypeDialog";
import { NewKeyspaceDialog } from "./NewKeyspaceDialog";
import { EditKeyspaceDialog } from "./EditKeyspaceDialog";
import { DropKeyspaceDialog } from "./DropKeyspaceDialog";
import { NewViewWizard } from "./NewViewWizard";
import { NewTableWizard } from "./NewTableWizard";
import { TruncateTableDialog } from "./TruncateTableDialog";
import { DropTableDialog } from "./DropTableDialog";
import { DropViewDialog } from "./DropViewDialog";
import { NewIndexDialog } from "./NewIndexDialog";
import { DropIndexDialog } from "./DropIndexDialog";
import type { ContextMenuItem } from "./SchemaContextMenu";
import { KeyMarker } from "../ui/KeyMarker";
import { TypeBadge } from "../ui/TypeBadge";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import {
  useCluster,
  useCopyDdl,
  useProfiles,
  useRefreshSchema,
  useSchema,
} from "../api/hooks";
import type { DdlObject } from "../api/hooks";
import { describeError } from "../api/client";
import { keySummary } from "../lib/keySummary";
import { useWorkspace } from "../store/workspace";
import { useToasts } from "../store/toast";
import type { Keyspace, Table } from "../lib/schemaModel";

const defaultClosed = (key: string) =>
  key.startsWith("fn:") || key.startsWith("trg:") || key === "system";

type ObjectKind = "table" | "view" | "type" | "keyspace";
interface MenuState {
  x: number;
  y: number;
  keyspace: string;
  kind: ObjectKind;
  name: string;
}

/**
 * The left dock: a filter box and the keyspace tree built from the connected profile's real schema
 * (Tables, Views, Types, Functions, Triggers per keyspace, with system keyspaces collapsed under a System
 * group). Table rows show a key summary on hover, list their materialized views as children and
 * expand to columns with key markers and type badges while selected. Right-click opens a context
 * menu (Open, New query here, Copy name, Copy DDL, Refresh); the toolbar button re-reads metadata.
 */
export function SchemaTree() {
  const [filter, setFilter] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [newTypeKs, setNewTypeKs] = useState<string | null>(null);
  const [newTableKs, setNewTableKs] = useState<string | null>(null);
  const [newKsOpen, setNewKsOpen] = useState(false);
  const [editKs, setEditKs] = useState<string | null>(null);
  const [dropKs, setDropKs] = useState<string | null>(null);
  const [truncate, setTruncate] = useState<{
    keyspace: string;
    name: string;
  } | null>(null);
  const [dropTable, setDropTable] = useState<{
    keyspace: string;
    name: string;
  } | null>(null);
  const [dropView, setDropView] = useState<{
    keyspace: string;
    name: string;
  } | null>(null);
  const [newView, setNewView] = useState<{
    keyspace: string;
    baseTable?: string;
  } | null>(null);
  const [newIndex, setNewIndex] = useState<{
    keyspace: string;
    name: string;
  } | null>(null);
  const [dropIndex, setDropIndex] = useState<{
    keyspace: string;
    name: string;
  } | null>(null);
  const [selectedKs, setSelectedKs] = useState<string | null>(null);
  const [pendingKs, setPendingKs] = useState<string | null>(null);
  const active = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeId));
  const open = useWorkspace((s) => s.open);
  const newQuery = useWorkspace((s) => s.newQuery);
  const profileId = useWorkspace((s) => s.profileId);
  const connected = useWorkspace(
    (s) => s.connections[s.profileId]?.status === "connected",
  );
  const {
    data: keyspaces,
    isLoading,
    error,
    refetch,
  } = useSchema(profileId, connected);
  const { data: cluster } = useCluster(profileId, connected);
  const { data: profiles } = useProfiles();
  const astra = !!profiles?.find((p) => p.name === profileId)?.astra
    ?.secure_bundle;
  const refresh = useRefreshSchema(profileId);
  const pushToast = useToasts((s) => s.push);
  const copyDdl = useCopyDdl(profileId);
  const closeTab = useWorkspace((s) => s.close);

  // After a keyspace is created the schema refetches asynchronously; once it shows up, reveal it.
  useEffect(() => {
    if (!pendingKs || !keyspaces?.some((k) => k.name === pendingKs)) return;
    setToggled((t) => ({ ...t, [`ks:${pendingKs}`]: true }));
    setSelectedKs(pendingKs);
    setPendingKs(null);
    setFilter("");
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-ks="${CSS.escape(pendingKs)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }, [pendingKs, keyspaces]);

  const q = filter.trim().toLowerCase();
  const isOpen = (key: string) =>
    q ? true : (toggled[key] ?? !defaultClosed(key));
  const toggle = (key: string) =>
    setToggled((t) => ({ ...t, [key]: !isOpen(key) }));
  const match = (s: string) => !q || s.toLowerCase().includes(q);

  const user = useMemo(
    () => (keyspaces ?? []).filter((k) => !k.system),
    [keyspaces],
  );
  const system = useMemo(
    () => (keyspaces ?? []).filter((k) => k.system),
    [keyspaces],
  );
  const counts = {
    keyspaces: user.length,
    tables: user.reduce((n, k) => n + k.tables.length, 0),
    types: user.reduce((n, k) => n + k.types.length, 0),
  };

  const isSel = (kind: string, ks: string, name: string) =>
    !!active &&
    active.kind === kind &&
    active.keyspace === ks &&
    active.object === name;

  const onContext = (
    e: MouseEvent,
    keyspace: string,
    kind: ObjectKind,
    name: string,
  ) => {
    e.preventDefault();
    if (
      kind === "keyspace" &&
      keyspaces?.find((k) => k.name === keyspace)?.system
    )
      return;
    setMenu({ x: e.clientX, y: e.clientY, keyspace, kind, name });
  };

  const menuItems = (m: MenuState): ContextMenuItem[] => {
    if (m.kind === "keyspace")
      return [
        {
          label: "New table…",
          icon: <Table2 size={14} />,
          onSelect: () => setNewTableKs(m.keyspace),
        },
        {
          label: "New type…",
          icon: <Braces size={14} />,
          onSelect: () => setNewTypeKs(m.keyspace),
        },
        {
          label: "New query here",
          icon: <FileText size={14} />,
          onSelect: () => newQuery({ keyspace: m.keyspace }),
        },
        {
          label: "Copy name",
          icon: <Copy size={14} />,
          onSelect: () => void navigator.clipboard?.writeText(m.keyspace),
        },
        {
          label: "Refresh",
          icon: <RefreshCw size={14} />,
          onSelect: () => refresh.mutate(),
        },
        {
          label: "Edit keyspace…",
          icon: <Pencil size={14} />,
          separatorBefore: true,
          onSelect: () => setEditKs(m.keyspace),
        },
        {
          label: "Drop keyspace…",
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => setDropKs(m.keyspace),
        },
      ];
    const fq = `${m.keyspace}.${m.name}`;
    const kind = m.kind;
    const ddlObject: DdlObject = kind;
    const target = { keyspace: m.keyspace, name: m.name };
    return [
      {
        label: "Open",
        icon: <ExternalLink size={14} />,
        onSelect: () => open(kind, m.keyspace, m.name),
      },
      {
        label: "New query here",
        icon: <FileText size={14} />,
        onSelect: () =>
          newQuery({
            keyspace: m.keyspace,
            cql: kind === "type" ? undefined : `SELECT * FROM ${fq} LIMIT 100;`,
          }),
      },
      ...(kind === "table"
        ? [
            {
              label: "Edit schema",
              icon: <Pencil size={14} />,
              onSelect: () => open("table", m.keyspace, m.name),
            },
            {
              label: "New view…",
              icon: <Eye size={14} />,
              onSelect: () => setNewView({ keyspace: m.keyspace, baseTable: m.name }),
            },
            {
              label: "New index…",
              icon: <Search size={14} />,
              onSelect: () => setNewIndex(target),
            },
            {
              label: "Truncate…",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setTruncate(target),
            },
            {
              label: "Drop table…",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setDropTable(target),
            },
          ]
        : []),
      ...(kind === "view"
        ? [
            {
              label: "Drop view…",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setDropView(target),
            },
          ]
        : []),
      {
        label: "Copy name",
        icon: <Copy size={14} />,
        onSelect: () => void navigator.clipboard?.writeText(fq),
      },
      {
        label: "Copy DDL",
        icon: <Copy size={14} />,
        onSelect: () => void copyDdl(m.keyspace, ddlObject, m.name),
      },
      {
        label: "Refresh",
        icon: <RefreshCw size={14} />,
        onSelect: () => refresh.mutate(),
      },
    ];
  };

  const rowMenuButton = (
    keyspace: string,
    kind: ObjectKind,
    name: string,
    label: string,
  ) => (
    <IconButton
      label={label}
      icon={<EllipsisVertical size={13} />}
      aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ x: r.left, y: r.bottom, keyspace, kind, name });
      }}
      className="absolute right-1 top-[1px] opacity-0 focus:opacity-100 group-hover:opacity-100"
    />
  );

  const renderIndexes = (t: Table) =>
    t.indexes.map((i) => (
      <div
        key={`idx/${i.name}`}
        className="flex h-6 items-center gap-[5px] pl-[58px] pr-2"
        role="treeitem"
        aria-selected="false"
      >
        <Search size={12} className="shrink-0 text-muted" aria-hidden />
        <span className="overflow-hidden text-ellipsis font-mono text-xs text-muted">
          {i.name}
        </span>
        <span className="ml-auto text-[11px] text-faint">{i.badge ?? "2i"}</span>
        {i.badge !== "custom" && (
          <IconButton
            label={`Drop index ${i.name}`}
            icon={<Trash2 size={12} />}
            onClick={() => setDropIndex({ keyspace: t.keyspace, name: i.name })}
          />
        )}
      </div>
    ));

  const renderColumns = (t: Table) => (
    <>
      {t.columns.slice(0, 6).map((c) => (
        <div
          key={c.name}
          className="flex h-6 items-center gap-[5px] pl-[58px] pr-2"
          role="treeitem"
          aria-selected="false"
        >
          <span className="inline-flex w-[26px] shrink-0">
            <KeyMarker kind={c.kind} position={c.position} order={c.order} />
          </span>
          <span className="overflow-hidden text-ellipsis font-mono text-xs text-muted">
            {c.name}
          </span>
          <span className="ml-auto">
            <TypeBadge type={c.type} />
          </span>
        </div>
      ))}
      {t.columns.length > 6 && (
        <div className="flex h-6 items-center pl-[58px] text-xs text-faint">
          {t.columns.length - 6} more columns
        </div>
      )}
    </>
  );

  const renderKeyspace = (k: Keyspace) => {
    const tables = k.tables.filter((t) => match(t.name) || match(k.name));
    const views = k.views.filter((v) => match(v.name) || match(k.name));
    const types = k.types.filter((t) => match(t.name) || match(k.name));
    const fns = k.functions.filter((f) => match(f) || match(k.name));
    const triggers = (k.triggers ?? []).filter(
      (g) => match(g.name) || match(g.table) || match(k.name),
    );
    if (
      q &&
      !tables.length &&
      !views.length &&
      !types.length &&
      !fns.length &&
      !triggers.length &&
      !match(k.name)
    )
      return null;
    const kOpen = isOpen(`ks:${k.name}`);
    const group = (
      id: string,
      name: string,
      count: number,
      children: ReactNode,
      add?: { label: string; run: () => void },
    ) =>
      count > 0 || !q ? (
        <div key={id}>
          <div className="group relative">
            <TreeRow
              indent={22}
              label={name}
              muted
              expanded={isOpen(id)}
              meta={count}
              onClick={() => toggle(id)}
            />
            {add && (
              <IconButton
                label={add.label}
                icon={<Plus size={13} />}
                onClick={add.run}
                className="absolute right-1 top-[1px] opacity-0 focus:opacity-100 group-hover:opacity-100"
              />
            )}
          </div>
          {isOpen(id) && children}
        </div>
      ) : null;
    const viewRow = (
      v: Keyspace["views"][number],
      indent: number,
      key = v.name,
    ) => (
      <div
        key={key}
        className="group relative"
        onContextMenu={(e) => onContext(e, k.name, "view", v.name)}
      >
        <TreeRow
          indent={indent}
          label={v.name}
          mono
          selected={isSel("view", k.name, v.name)}
          icon={<Eye size={14} />}
          title={keySummary(v.columns)}
          onClick={() => open("view", k.name, v.name)}
        />
        {rowMenuButton(k.name, "view", v.name, `View actions for ${v.name}`)}
      </div>
    );
    return (
      <div key={k.name} role="group">
        <div
          data-ks={k.name}
          className="group relative"
          onContextMenu={(e) => onContext(e, k.name, "keyspace", k.name)}
        >
          <TreeRow
            indent={6}
            label={k.name}
            selected={selectedKs === k.name}
            icon={<Database size={14} />}
            expanded={kOpen}
            meta={
              k.system ? undefined : (
                <span className="mr-5 inline-flex">
                  <Tooltip content={`Replication: ${k.replication}`}>
                    <span
                      role="img"
                      aria-label={`Replication: ${k.replication}`}
                    >
                      <Layers size={13} />
                    </span>
                  </Tooltip>
                </span>
              )
            }
            onClick={() => toggle(`ks:${k.name}`)}
          />
          {!k.system && (
            <IconButton
              label="Keyspace actions"
              icon={<EllipsisVertical size={13} />}
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({
                  x: r.left,
                  y: r.bottom,
                  keyspace: k.name,
                  kind: "keyspace",
                  name: k.name,
                });
              }}
              className={`absolute right-1 top-[1px] focus:opacity-100 group-hover:opacity-100 ${selectedKs === k.name ? "opacity-100" : "opacity-0"}`}
            />
          )}
        </div>
        {kOpen && (
          <>
            {group(
              `tables:${k.name}`,
              "Tables",
              tables.length,
              tables.map((t) => {
                const sel = isSel("table", k.name, t.name);
                const children = k.views.filter((v) => v.baseTable === t.name);
                return (
                  <div
                    key={t.name}
                    onContextMenu={(e) => onContext(e, k.name, "table", t.name)}
                  >
                    <div className="group relative">
                      <TreeRow
                        indent={40}
                        label={t.name}
                        mono
                        selected={sel}
                        icon={<Table2 size={14} />}
                        meta={
                          t.counter ? (
                            <Tooltip content="Counter table">
                              <span role="img" aria-label="Counter table">
                                <Hash size={13} />
                              </span>
                            </Tooltip>
                          ) : undefined
                        }
                        title={keySummary(t.columns)}
                        onClick={() => open("table", k.name, t.name)}
                      />
                      {rowMenuButton(
                        k.name,
                        "table",
                        t.name,
                        `Table actions for ${t.name}`,
                      )}
                    </div>
                    {sel && renderColumns(t)}
                    {sel && renderIndexes(t)}
                    {children.map((v) => viewRow(v, 58, `${t.name}/${v.name}`))}
                  </div>
                );
              }),
            )}
            {group(
              `views:${k.name}`,
              "Views",
              views.length,
              views.map((v) => viewRow(v, 40)),
              k.system
                ? undefined
                : { label: "New view", run: () => setNewView({ keyspace: k.name }) },
            )}
            {group(
              `types:${k.name}`,
              "Types",
              types.length,
              types.map((t) => (
                <div
                  key={t.name}
                  onContextMenu={(e) => onContext(e, k.name, "type", t.name)}
                >
                  <TreeRow
                    indent={40}
                    label={t.name}
                    mono
                    selected={isSel("type", k.name, t.name)}
                    icon={<Braces size={14} />}
                    onClick={() => open("type", k.name, t.name)}
                  />
                </div>
              )),
              {
                label: `New type in ${k.name}`,
                run: () => setNewTypeKs(k.name),
              },
            )}
            {group(
              `fn:${k.name}`,
              "Functions",
              fns.length,
              fns.map((f) => (
                <TreeRow
                  key={f}
                  indent={40}
                  label={f}
                  mono
                  icon={<FunctionSquare size={14} />}
                />
              )),
            )}
            {group(
              `trg:${k.name}`,
              "Triggers",
              triggers.length,
              triggers.map((g) => (
                <TreeRow
                  key={`${g.table}/${g.name}`}
                  indent={40}
                  label={`${g.table}.${g.name}`}
                  mono
                  icon={<Zap size={14} />}
                  title={g.class}
                />
              )),
            )}
          </>
        )}
      </div>
    );
  };

  const body = (() => {
    if (!connected)
      return (
        <p className="m-0 px-3 py-4 text-muted">
          Connect a profile to browse its schema.
        </p>
      );
    if (isLoading)
      return <p className="m-0 px-3 py-4 text-muted">Reading schema…</p>;
    if (error)
      return (
        <div className="px-3 py-4 text-muted" role="alert">
          <p className="mt-0">
            Could not read the schema: {describeError(error)}
          </p>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => void refetch()}
          >
            Try again
          </button>
        </div>
      );
    return (
      <>
        {user.map(renderKeyspace)}
        {(!q || system.some((k) => match(k.name))) && system.length > 0 && (
          <>
            <div className="mx-3 my-2 h-px bg-line2" />
            <TreeRow
              indent={6}
              label="System"
              muted
              expanded={isOpen("system")}
              icon={<Lock size={14} />}
              meta={`${system.length} keyspaces`}
              onClick={() => toggle("system")}
            />
            {isOpen("system") &&
              system
                .filter((k) => match(k.name))
                .map((k) => (
                  <TreeRow
                    key={k.name}
                    indent={22}
                    label={k.name}
                    mono
                    muted
                    icon={<Database size={14} />}
                  />
                ))}
          </>
        )}
      </>
    );
  })();

  return (
    <aside
      aria-label="Schema"
      className="flex min-h-0 flex-col border-r border-line bg-surface"
    >
      <div className="flex items-center gap-1.5 border-b border-line2 py-1.5 pl-3 pr-2">
        <h2 className="m-0 text-[13px] font-medium">Schema</h2>
        <span className="flex-1" />
        <IconButton
          label="New query"
          icon={<Plus size={14} />}
          onClick={() => newQuery()}
        />
        {!astra && (
          <IconButton
            label="New keyspace"
            icon={<FolderPlus size={14} />}
            disabled={!connected}
            title={connected ? "New keyspace" : "Connect to a profile first"}
            onClick={() => setNewKsOpen(true)}
          />
        )}
        <IconButton
          label="Refresh schema"
          icon={
            <RefreshCw
              size={14}
              className={refresh.isPending ? "animate-spin" : undefined}
            />
          }
          disabled={!connected || refresh.isPending}
          onClick={() => refresh.mutate()}
        />
      </div>
      <label className="m-2 flex h-[26px] items-center gap-1.5 rounded border border-line bg-editor px-2 text-muted focus-within:border-focus">
        <Search size={14} aria-hidden />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter keyspaces, tables, types"
          aria-label="Filter schema"
          className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-faint"
        />
      </label>
      <nav
        role="tree"
        aria-label="Schema tree"
        className="flex-1 overflow-auto pb-3 pt-0.5"
      >
        {body}
      </nav>
      {connected && keyspaces && (
        <div className="flex gap-2.5 border-t border-line2 px-3 py-1.5 text-xs text-muted">
          <span>{counts.keyspaces} keyspaces</span>
          <span>{counts.tables} tables</span>
          <span>{counts.types} types</span>
        </div>
      )}
      {newKsOpen && (
        <NewKeyspaceDialog
          onCreated={(name) => {
            setPendingKs(name);
            pushToast(`Keyspace ${name} created`);
          }}
          onClose={() => setNewKsOpen(false)}
        />
      )}
      {editKs && (
        <EditKeyspaceDialog
          keyspace={editKs}
          onChanged={(name) => {
            refresh.mutate();
            pushToast(`Keyspace ${name} changed`);
          }}
          onClose={() => setEditKs(null)}
        />
      )}
      {dropKs && (
        <DropKeyspaceDialog
          keyspace={dropKs}
          onDropped={(name) => {
            for (const t of useWorkspace.getState().tabs)
              if (t.keyspace === name) closeTab(t.id);
            setSelectedKs((k) => (k === name ? null : k));
            refresh.mutate();
            pushToast(`Keyspace ${name} dropped`);
          }}
          onClose={() => setDropKs(null)}
        />
      )}
      {truncate && (
        <TruncateTableDialog
          keyspace={truncate.keyspace}
          table={truncate.name}
          onTruncated={() => {
            useWorkspace.getState().bumpDataEpoch();
            pushToast(`Table ${truncate.name} truncated`);
          }}
          onClose={() => setTruncate(null)}
        />
      )}
      {dropTable && (
        <DropTableDialog
          keyspace={dropTable.keyspace}
          table={dropTable.name}
          views={
            keyspaces
              ?.find((k) => k.name === dropTable.keyspace)
              ?.views.filter((v) => v.baseTable === dropTable.name)
              .map((v) => v.name) ?? []
          }
          onDropped={() => {
            for (const t of useWorkspace.getState().tabs)
              if (
                t.kind === "table" &&
                t.keyspace === dropTable.keyspace &&
                t.object === dropTable.name
              )
                closeTab(t.id);
            refresh.mutate();
            pushToast(`Table ${dropTable.name} dropped`);
          }}
          onClose={() => setDropTable(null)}
        />
      )}
      {newIndex && (
        <NewIndexDialog
          table={
            keyspaces
              ?.find((k) => k.name === newIndex.keyspace)
              ?.tables.find((t) => t.name === newIndex.name) as Table
          }
          serverMajor={parseInt(cluster?.release_version ?? "0", 10) || 0}
          onCreated={() => {
            refresh.mutate();
            pushToast("Index created");
          }}
          onClose={() => setNewIndex(null)}
        />
      )}
      {dropIndex && (
        <DropIndexDialog
          keyspace={dropIndex.keyspace}
          index={dropIndex.name}
          onDropped={() => {
            refresh.mutate();
            pushToast(`Index ${dropIndex.name} dropped`);
          }}
          onError={(m) => pushToast(m)}
          onClose={() => setDropIndex(null)}
        />
      )}
      {dropView && (
        <DropViewDialog
          keyspace={dropView.keyspace}
          view={dropView.name}
          onDropped={() => {
            for (const t of useWorkspace.getState().tabs)
              if (
                t.kind === "view" &&
                t.keyspace === dropView.keyspace &&
                t.object === dropView.name
              )
                closeTab(t.id);
            refresh.mutate();
            pushToast(`View ${dropView.name} dropped`);
          }}
          onClose={() => setDropView(null)}
        />
      )}
      {newView && (
        <NewViewWizard
          keyspace={newView.keyspace}
          baseTable={newView.baseTable}
          onCreated={(name) => {
            setToggled((t) => ({
              ...t,
              [`ks:${newView.keyspace}`]: true,
              [`views:${newView.keyspace}`]: true,
            }));
            open("view", newView.keyspace, name);
            pushToast(`View ${name} created`);
            refresh.mutate();
          }}
          onClose={() => setNewView(null)}
        />
      )}
      {newTableKs && (
        <NewTableWizard
          keyspace={newTableKs}
          onCreated={(name) => {
            setToggled((t) => ({
              ...t,
              [`ks:${newTableKs}`]: true,
              [`tables:${newTableKs}`]: true,
            }));
            open("table", newTableKs, name);
            pushToast(`Table ${name} created`);
          }}
          onClose={() => setNewTableKs(null)}
        />
      )}
      {newTypeKs && (
        <NewTypeDialog
          keyspace={newTypeKs}
          onClose={() => setNewTypeKs(null)}
        />
      )}
      {menu && (
        <SchemaContextMenu
          x={menu.x}
          y={menu.y}
          label={
            menu.kind === "keyspace"
              ? menu.keyspace
              : `${menu.keyspace}.${menu.name}`
          }
          items={menuItems(menu)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
