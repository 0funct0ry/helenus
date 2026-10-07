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
  explain?: string[]
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
  /** Defaults to create; alter and drop target the existing keyspace `name`. */
  action?: 'create' | 'alter' | 'drop'
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
  /** Plain-language description of what the statement does. */
  explain?: string[]
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

/** Options an "options" table action may change; unset fields are left alone. */
export interface AlterTableOptions {
  comment?: string
  default_ttl_seconds?: number
  gc_grace_seconds?: number
  bloom_filter_fp_chance?: number
  compaction?: { class: string }
  compression?: { class: string }
  caching?: { keys: string; rows_per_partition: string }
  speculative_retry?: string
  read_repair?: string
}

/** A request to change an existing table (SPEC §9.17), sent to the same preview endpoint as TableRequest. */
export interface TableActionRequest {
  action: 'add_column' | 'drop_column' | 'rename_column' | 'options' | 'truncate' | 'drop' | 'drop_view' | 'alter_view'
  keyspace: string
  name: string
  column?: { name: string; type?: TypeDesc; static?: boolean }
  from?: string
  to?: string
  alter?: AlterTableOptions
}

/** The CREATE TABLE statement a request would run, with blocking errors and non-blocking notes. */
export type TablePlan = KeyspacePlan

/** Body of POST /p/:profile/views/preview (SPEC §9.19). `columns` is `['*']` for all columns. */
export interface ViewRequest {
  action?: 'create' | 'alter' | 'drop'
  keyspace: string
  name: string
  base_table: string
  columns: string[]
  partition_key: string[]
  clustering: { column: string; order: 'ASC' | 'DESC' }[]
  extra_where: string
  options: TableRequest['options']
  if_not_exists: boolean
}

export type ViewPlan = KeyspacePlan

export type IndexTarget = 'plain' | 'VALUES' | 'KEYS' | 'ENTRIES' | 'FULL'
export type IndexKind = 'legacy' | 'sai'

export interface IndexOptions {
  case_sensitive?: boolean
  normalize?: boolean
  ascii?: boolean
  similarity_function?: string
}

/** Body of POST /p/:profile/indexes/preview (SPEC §9.18). */
export interface IndexRequest {
  action: 'create' | 'drop'
  keyspace: string
  table?: string
  name?: string
  column?: string
  target?: IndexTarget
  kind?: IndexKind
  options?: IndexOptions
  if_not_exists?: boolean
  if_exists?: boolean
}

export type IndexPlan = KeyspacePlan

/** Body of POST /p/:profile/triggers/preview (SPEC §9.22). */
export interface TriggerRequest {
  action: 'create' | 'drop'
  keyspace: string
  table: string
  name?: string
  class?: string
  if_not_exists?: boolean
  if_exists?: boolean
}

export type TriggerPlan = KeyspacePlan

export interface SchemaFunction {
  keyspace: string
  name: string
  arg_names: string[]
  arg_types: string[]
  return_type: string
  language: string
  body: string
  called_on_null_input: boolean
}

export interface SchemaAggregate {
  keyspace: string
  name: string
  arg_types: string[]
  state_func: string
  state_type: string
  final_func?: string
  init_cond?: string
  return_type: string
}

/** One argument of a function in a `FunctionRequest`; `type` is a CQL type such as `decimal` or `list<int>`. */
export interface FunctionArg {
  name: string
  type: string
}

/** Body of POST /p/{profile}/functions/preview (SPEC §9.20). Drop needs only the name and argument types. */
export interface FunctionRequest {
  action: 'create' | 'replace' | 'drop'
  keyspace: string
  name: string
  args: FunctionArg[]
  returns?: string
  called_on_null?: boolean
  language?: 'java' | 'javascript'
  body?: string
  if_not_exists?: boolean
}

export type FunctionPlan = KeyspacePlan

/** Body of POST /p/{profile}/aggregates/preview (SPEC §9.21). Drop needs only the name and argument types. */
export interface AggregateRequest {
  action: 'create' | 'replace' | 'drop'
  keyspace: string
  name: string
  arg_types: string[]
  sfunc?: string
  stype?: string
  finalfunc?: string
  /** A JSON value rendered as a CQL literal of the state type; omitted for no INITCOND. */
  initcond?: unknown
  if_not_exists?: boolean
}

export type AggregatePlan = KeyspacePlan

/** A function offered for the SFUNC or FINALFUNC slot; `reason` says what signature a disabled one lacks. */
export interface AggregateCandidate {
  name: string
  signature: string
  returns: string
  ok: boolean
  reason?: string
}

/** Result of POST /p/{profile}/aggregates/test. */
export interface AggregateTestResult {
  value: unknown
  type: TypeDesc
  elapsed_ms: number
  cql: string
  limit: number
}

/** Result of POST /p/{profile}/functions/invoke: the codec-encoded value, its type and the elapsed time. */
export interface InvokeResult {
  value: unknown
  type: TypeDesc
  elapsed_ms: number
  cql: string
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
  aggregates: SchemaAggregate[]
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

/** A resource a permission can be granted on (SPEC §9.23). */
export interface RoleResource {
  kind: string
  keyspace?: string
  name?: string
  signature?: string[]
}

/** A request to `/p/{profile}/roles/preview` or `/roles/apply`. The password only ever travels in these bodies. */
export interface RoleRequest {
  action: 'create' | 'alter' | 'drop' | 'grant_role' | 'revoke_role' | 'grant' | 'revoke'
  role: string
  password?: string
  login?: boolean
  superuser?: boolean
  options?: Record<string, string>
  member_of?: string
  permission?: string
  resource?: RoleResource
  if_not_exists?: boolean
}

export type RolePlan = KeyspacePlan

export interface RoleInfo {
  name: string
  login: boolean
  superuser: boolean
  options: Record<string, string>
  member_of: string[]
  members: string[]
}

export interface RolesResponse {
  auth_enabled: boolean
  authorizer_enabled: boolean
  connected_role: string
  roles: RoleInfo[]
  /** Permissions that apply to each resource kind, ALL first. */
  applicable: Record<string, string[]>
}

export interface RolePermission {
  resource: RoleResource
  permission: string
}

/** One data-modeling finding from `GET /p/{profile}/advise`. `table` is empty for keyspace-level findings. */
export interface AdviceFinding {
  id: string
  severity: 'info' | 'warning'
  message: string
  help_url: string
  keyspace: string
  table?: string
}

/** One generator choice for a seeded column or nested element; see the generator reference. */
export interface SeedSpec {
  type?: string
  gen: string
  params?: Record<string, unknown>
  null_percent?: number
  element?: SeedSpec
  key?: SeedSpec
  fields?: Record<string, SeedSpec>
}

export interface SeedConfig {
  seed: number
  total_rows: number
  rows_per_partition: number
  concurrency: number
  consistency: string
  ttl: number
  if_not_exists: boolean
  columns: Record<string, SeedSpec>
}

export interface SeedColumnInfo {
  name: string
  type: string
  desc: TypeDesc
  kind: 'partition' | 'clustering' | 'static' | 'regular'
  key: boolean
  /** Generator names that can fill this column. */
  compatible: string[]
}

export interface SeedFieldError {
  field: string
  message: string
}

/** Response of `POST /p/{profile}/seed/preview`: the defaults-filled config, 20 rows and the sample statement. */
export interface SeedPreview {
  config: SeedConfig
  columns: SeedColumnInfo[]
  notes: string[]
  errors: SeedFieldError[]
  rows: unknown[][]
  statement: string
  counter: boolean
  partitions?: number
}

export interface JobProgress {
  done: number
  total: number
  errors: number
  rate_per_s: number
  eta_s: number
}

export interface SeedResult {
  written: number
  errors: number
  skipped_duplicates: number
  partitions: number
  first_errors: string[]
  keyspace: string
  table: string
}

export interface JobInfo {
  id: string
  kind: string
  profile: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
  progress: JobProgress
  started_at: string
  ended_at?: string
  result?: SeedResult | ExportResult | ImportResult | { error: string }
}

export interface SeedProfile {
  id: number
  keyspace: string
  table: string
  name: string
  config: SeedConfig
  created_at: string
  updated_at: string
}

export type ExportFormat = 'csv' | 'json' | 'ndjson' | 'xml' | 'excel' | 'cql'

/** Format options of an export (only the ones that apply to the chosen format are used). */
export interface ExportOptions {
  header: boolean
  delimiter: string
  quote: string
  null_string: string
  datetime_format: string
}

/** Where an export reads from: a whole table (optionally narrowed) or the text of a SELECT. */
export type ExportSource = { kind: 'table'; keyspace: string; table: string } | { kind: 'query'; cql: string }

/** A saved export configuration. `profile` is empty for presets shared by every profile; `columns` null means all. */
export interface ExportPreset {
  id: number
  profile: string
  name: string
  format: ExportFormat
  options: Partial<ExportOptions>
  columns: string[] | null
  created_at: string
  updated_at: string
}

export interface ExportResult {
  filename: string
  rows: number
  bytes: number
  format: ExportFormat
}

export type ImportFormatKind = 'csv' | 'json' | 'ndjson'

/** How the uploaded file is read; the server detects the first value. */
export interface ImportFormat {
  format: ImportFormatKind
  delimiter: string
  quote: string
  header: boolean
  null_string: string
}

export interface ImportUploadResult {
  upload: string
  name: string
  size: number
  detect: Omit<ImportFormat, 'null_string'>
}

/** A target column and the source column feeding it; an empty source skips the target. */
export interface ImportMapping {
  target: string
  source: string
}

export interface ImportOptions {
  consistency: string
  ttl: number
  if_not_exists: boolean
  concurrency: number
  batch_size: number
  max_errors: number
}

export interface ImportRowError {
  line: number
  column: string
  value: string
  reason: string
}

export type ImportConfidence = '' | 'exact' | 'case' | 'normalized' | 'fuzzy' | 'manual'

export interface ImportPlanColumn {
  target: string
  type: string
  kind: 'partition' | 'clustering' | 'static' | 'regular'
  source: string
  confidence: ImportConfidence
  failures: number
  samples: ImportRowError[]
}

export interface ImportPlan {
  format: ImportFormat
  size: number
  source_columns: string[]
  /** The first 20 records as text, in source column order. */
  preview: string[][]
  columns: ImportPlanColumn[]
  /** Problems that block the import, such as "Map a source column to user_id". */
  errors: string[]
  rows_checked: number
}

export interface ImportDryRun {
  rows: number
  valid: number
  invalid: number
  errors: ImportRowError[]
  truncated: boolean
}

export interface ImportResult {
  rows: number
  written: number
  rejected: number
  first_errors: ImportRowError[]
  keyspace: string
  table: string
}

/** The ten Copy As formats of `POST /p/{profile}/rows/format` (SPEC §9.5.1). */
export type RowFormat = 'json' | 'csv' | 'tsv' | 'xml' | 'yaml' | 'markdown' | 'html' | 'sql_inserts' | 'sql_updates' | 'where'

/** Body of `POST /p/{profile}/rows/format`. Rows are positional wire values aligned with `columns`. */
export interface RowsFormatRequest {
  format: RowFormat
  source: { keyspace: string; table: string } | null
  columns: QueryColumn[]
  rows: unknown[][]
  counter?: boolean
}

/** Body of `POST /p/{profile}/rows/aggregate`. */
export interface RowsAggregateRequest {
  columns: QueryColumn[]
  rows: unknown[][]
}

/** Response of `POST /p/{profile}/rows/aggregate`: the figures in display order and as copyable text. */
export interface RowsAggregateResponse {
  lines: { key: string; value: string }[]
  text: string
}
