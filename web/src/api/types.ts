/** Shapes returned by the Helenus JSON API (SPEC §11). Secrets are never present. */

export interface ApiProfile {
  name: string
  hosts: string[]
  port: number
  keyspace?: string
  consistency?: string
  serial_consistency?: string
  dc?: string
  username?: string
  tls: { enabled: boolean; ca_cert?: string; cert?: string; key?: string; server_name?: string; insecure_skip_verify: boolean }
  astra: { secure_bundle?: string }
  connect_timeout?: string
  request_timeout?: string
  protocol_version?: number
  password_set: boolean
  password_command_set: boolean
  token_set: boolean
  token_command_set: boolean
  connected: boolean
}

export interface ClusterNode {
  address: string
  dc: string
  rack: string
  version: string
  host_id: string
}

export interface ClusterInfo {
  name: string
  release_version: string
  cql_version: string
  protocol_version: string
  local_dc: string
  datacenters: string[]
  nodes: ClusterNode[]
  node_count: number
}

export interface StageResult {
  name: string
  ok: boolean
  detail?: string
}

export interface TestResult {
  ok: boolean
  failed_stage?: string
  error?: string
  stages: StageResult[]
  info?: ClusterInfo
  rtt_ms?: number
  warnings?: string[]
}

export interface ConnectResult {
  profile: string
  connected: boolean
  cluster: ClusterInfo
  warnings?: string[]
  insecure_tls: boolean
}

export interface BundleInfo {
  path: string
  host: string
  keyspace: string
  local_dc: string
}

/** CQL type descriptor (SPEC §7.3). */
export interface TypeDesc {
  name: string
  frozen?: boolean
  args?: TypeDesc[]
  udt?: { keyspace: string; name: string }
  size?: number
}

export interface SchemaColumn {
  name: string
  type: TypeDesc
  /** The type rendered as CQL, e.g. `frozen<address>`. */
  cql: string
  kind: 'partition' | 'clustering' | 'static' | 'regular'
  position?: number
  order?: 'ASC' | 'DESC'
}

export interface SchemaOption {
  name: string
  value: string
}

export interface SchemaIndex {
  name: string
  kind: string
  target: string
  column: string
  class?: string
  sai?: boolean
  options?: Record<string, string>
}

export interface SchemaTable {
  keyspace: string
  name: string
  columns: SchemaColumn[]
  options: SchemaOption[]
  indexes: SchemaIndex[]
  triggers?: SchemaTrigger[]
  views: string[]
  counter?: boolean
}

export interface SchemaTrigger {
  name: string
  class: string
}

export interface SchemaView {
  keyspace: string
  name: string
  base_table: string
  columns: SchemaColumn[]
  options: SchemaOption[]
  where_clause: string
  include_all_columns: boolean
}

export interface SchemaUdt {
  keyspace: string
  name: string
  fields: { name: string; type: TypeDesc; cql: string }[]
  used_by: string[]
}

/** A request to `POST /p/{profile}/types/preview` (SPEC §9.11). */
export interface TypeRequest {
  action: 'create' | 'add_field' | 'rename_field' | 'drop'
  keyspace: string
  name: string
  fields?: { name: string; type: TypeDesc }[]
  field?: { name: string; type: TypeDesc }
  from?: string
  to?: string
}

/** The CQL a UDT action would run, with validation errors, builder notes and the type's dependents. */
export interface TypePlan {
  statement: string
  errors: string[]
  notes: string[]
  dependents: string[]
}

/** A request to `POST /p/{profile}/keyspaces/preview` (SPEC §9.3). */
export interface KeyspaceRequest {
  name: string
  strategy: 'SimpleStrategy' | 'NetworkTopologyStrategy'
  replication_factor: number
  datacenters: { name: string; rf: number }[]
  durable_writes: boolean
  if_not_exists: boolean
}

/** A validation problem tied to a form field, such as `name` or `datacenters.1.rf`. */
export interface PlanError {
  field: string
  message: string
  /** Wizard step (1-3) the error belongs to; set by the table planner only. */
  step?: number
}

/** The CREATE KEYSPACE statement a request would run, with blocking errors and non-blocking notes. */
export interface KeyspacePlan {
  statement: string
  errors: PlanError[]
  notes: string[]
}

/** A request to `POST /p/{profile}/tables/preview` (SPEC §9.13). Unset options mean the server default. */
export interface TableRequest {
  keyspace: string
  name: string
  if_not_exists: boolean
  columns: { name: string; type: TypeDesc; static: boolean }[]
  partition_key: string[]
  clustering: { column: string; order: 'ASC' | 'DESC' }[]
  options: {
    comment: string
    default_ttl_seconds: number
    gc_grace_seconds: number | null
    compaction: { class: string }
    compression: { class: string }
    bloom_filter_fp_chance: number | null
  }
}

/** The CREATE TABLE statement a request would run, with blocking errors and non-blocking notes. */
export type TablePlan = KeyspacePlan

export interface SchemaFunction {
  keyspace: string
  name: string
  arg_types: string[]
  return_type: string
}

export interface SchemaKeyspace {
  name: string
  system: boolean
  replication: Record<string, string>
  durable_writes: boolean
  tables: SchemaTable[]
  views: SchemaView[]
  types: SchemaUdt[]
  functions: SchemaFunction[]
  aggregates: SchemaFunction[]
}

/** `GET /p/{profile}/schema`. */
export interface SchemaSnapshot {
  keyspaces: SchemaKeyspace[]
  version: string
  generated_at: string
}

/** One result column of a query (SPEC §7.3). `kind` is set only when the column maps to a table column. */
export interface QueryColumn {
  name: string
  type: TypeDesc
  kind?: 'partition' | 'clustering' | 'static' | 'regular'
  position?: number
  order?: 'ASC' | 'DESC'
}

/** Body of `POST /p/{profile}/query`. */
export interface QueryRequest {
  cql: string
  keyspace: string
  consistency: string
  serial_consistency: string
  page_size: number
  page_state: string | null
  allow_filtering: boolean
  trace: boolean
  /** `ui` marks a statement issued by a UI dialog so the server logs it in the schema change history. */
  ddl_origin?: 'ui'
}

/** Response of `POST /p/{profile}/query`. Rows are positional, aligned with `columns`. */
export interface QueryResponse {
  kind: 'rows' | 'void' | 'schema_change'
  executed_cql: string
  columns: QueryColumn[]
  rows: unknown[][]
  page_state?: string
  has_more: boolean
  warnings: string[]
  trace_id?: string
  timing: { client_ms: number; coordinator_ms?: number }
  keyspace_after?: string
}

/** One statement located in editor text. Offsets are UTF-8 byte offsets, `end` exclusive. */
export interface SplitStatement {
  text: string
  start: number
  end: number
  line: number
  complete: boolean
}

/** Kinds of completion candidate (SPEC §10). */
export type CompleteKind = 'keyword' | 'keyspace' | 'table' | 'view' | 'column' | 'function' | 'type' | 'command'

/** One candidate from `POST /p/{profile}/complete`. */
export interface CompleteItem {
  label: string
  kind: CompleteKind
  /** Column type, table key summary or a short description. */
  detail?: string
  /** Text that replaces the word being typed, with identifier quoting applied. */
  insert: string
  /** Set on key columns: the column kind, its 1-based position and clustering order. */
  key?: 'partition' | 'clustering' | 'static'
  position?: number
  order?: 'ASC' | 'DESC'
}

export interface CompleteRequest {
  text: string
  /** UTF-16 index of the cursor in `text`. */
  cursor: number
  keyspace: string
}

export interface CompleteResponse {
  /** UTF-16 index where the insert text starts replacing the document. */
  from: number
  items: CompleteItem[]
}

/** The kinds of grid change `POST /p/{profile}/changes/*` accepts (SPEC §9.9). */
export type ChangeKind =
  | 'set_cell'
  | 'set_null'
  | 'insert_row'
  | 'delete_row'
  | 'counter_delta'
  | 'list_append'
  | 'list_prepend'
  | 'list_set_index'
  | 'list_remove_index'
  | 'set_add'
  | 'set_remove'
  | 'map_put'
  | 'map_remove'
  | 'udt_field_set'
  | 'replace_value'

/** One edit to one row, with values in the API's JSON encoding. */
export interface Change {
  kind: ChangeKind
  /** Primary key values by column name; static columns use the partition key only. */
  key?: Record<string, unknown>
  column?: string
  field?: string
  index?: number
  value?: unknown
  map_key?: unknown
  values?: Record<string, unknown>
  if_not_exists?: boolean
}

/** Body of `POST /p/{profile}/changes/preview` and `/changes/apply`. */
export interface ChangesRequest {
  keyspace: string
  table: string
  consistency: string
  serial_consistency?: string
  changes: Change[]
}

/** One compiled change: the prepared CQL and the same statement with literal values. */
export interface PreviewStatement {
  index: number
  kind: ChangeKind
  cql: string
  preview: string
  summary: string
}

/** The outcome of one change in `POST /p/{profile}/changes/apply`. */
export interface ChangeResult {
  index: number
  status: 'applied' | 'failed' | 'pending'
  executed_cql: string
  error?: { code: string; message: string }
}

export interface ApplyResponse {
  results: ChangeResult[]
  applied: number
  /** Index of the failed change, or -1. */
  failed_at: number
}

/** One bar in a node lane of `GET /p/{profile}/traces/{id}`, in µs on that node's own clock. */
export interface TraceBar {
  start_us: number
  end_us: number
  label: string
}

/** The events of one node. */
export interface TraceLane {
  node: string
  role: 'coordinator' | 'replica'
  bars: TraceBar[]
}

/** One row of the trace events table. */
export interface TraceEventRow {
  activity: string
  source: string
  elapsed_us: number
  thread: string
  timestamp_ms: number
}

/** Response of `GET /p/{profile}/traces/{id}`. */
export interface TraceResponse {
  id: string
  started_at: string
  duration_us: number
  summary: { coordinator: string; request: string; coordinator_ms: number; replicas_contacted: number; event_count: number; node_count: number }
  lanes: TraceLane[]
  events: TraceEventRow[]
}

/** One related object in a dependency listing (GET /deps). */
export interface DepItem {
  kind: string
  keyspace: string
  name: string
  signature?: string
  via: string
  blocking: boolean
}

export interface DepsResponse {
  dependents: DepItem[]
  dependencies: DepItem[]
}

/** One logged UI DDL statement (SPEC §9.15). The statement has passwords masked. */
export interface SchemaChange {
  id: number
  keyspace: string
  object_kind: string
  object_name: string
  action: string
  statement: string
  /** Empty when no reverse could be derived. */
  reverse: string
  reverse_note: string
  status: 'ok' | 'error'
  error: string
  duration_ms: number
  created_at: string
}

/** Response of `GET /p/{profile}/schema-changes`; `next_before` is null on the last page. */
export interface SchemaChangesPage {
  items: SchemaChange[]
  next_before: number | null
}
