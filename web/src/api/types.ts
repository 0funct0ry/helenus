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
