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
  views: string[]
  counter?: boolean
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
  timing: { client_ms: number }
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
