import type { Column, Keyspace, MaterializedView, Table, Udt } from './types'

const pk = (name: string, type: string, position: number): Column => ({ name, type, kind: 'partition', position })
const ck = (name: string, type: string, position: number, order: 'ASC' | 'DESC' = 'ASC'): Column => ({
  name,
  type,
  kind: 'clustering',
  position,
  order,
})
const st = (name: string, type: string): Column => ({ name, type, kind: 'static' })
const col = (name: string, type: string): Column => ({ name, type, kind: 'regular' })

const baseOptions = {
  compaction: "{'class': 'SizeTieredCompactionStrategy'}",
  gc_grace_seconds: '864000',
}

export const transactionsByMerchant: Table = {
  name: 'transactions_by_merchant',
  keyspace: 'payments',
  columns: [
    pk('merchant_id', 'uuid', 1),
    pk('txn_day', 'date', 2),
    ck('txn_time', 'timeuuid', 1, 'DESC'),
    st('merchant_name', 'text'),
    col('amount', 'decimal'),
    col('currency', 'text'),
    col('status', 'text'),
    col('tags', 'set<text>'),
    col('metadata', 'map<text, text>'),
    col('billing', 'frozen<address>'),
    col('history', 'list<decimal>'),
    col('geo', 'tuple<double, double>'),
    col('risk_embedding', 'vector<float, 3>'),
    col('raw_payload', 'blob'),
  ],
  options: {
    default_time_to_live: '7776000',
    gc_grace_seconds: '864000',
    compaction: "{'class': 'TimeWindowCompactionStrategy', 'compaction_window_size': '1', 'compaction_window_unit': 'DAYS'}",
    bloom_filter_fp_chance: '0.01',
  },
  indexes: [{ name: 'txn_by_currency_sai', column: 'currency', kind: 'Storage-attached (SAI)' }],
  views: ['transactions_by_status'],
}

export const ledgerCounters: Table = {
  name: 'ledger_counters',
  keyspace: 'payments',
  counter: true,
  columns: [pk('account_id', 'uuid', 1), ck('day', 'date', 1, 'DESC'), col('debits', 'counter'), col('credits', 'counter')],
  options: baseOptions,
  indexes: [],
  views: [],
}

export const merchants: Table = {
  name: 'merchants',
  keyspace: 'payments',
  columns: [pk('merchant_id', 'uuid', 1), col('name', 'text'), col('country', 'ascii'), col('created_at', 'timestamp'), col('hq', 'address'), col('categories', 'list<text>')],
  options: baseOptions,
  indexes: [],
  views: [],
}

export const customers: Table = {
  name: 'customers',
  keyspace: 'payments',
  columns: [pk('customer_id', 'uuid', 1), col('email', 'text'), col('home_address', 'address'), col('lifetime_value', 'decimal'), col('tokens', 'map<text, frozen<card_token>>')],
  options: baseOptions,
  indexes: [],
  views: [],
}

export const cardTokens: Table = {
  name: 'card_tokens',
  keyspace: 'payments',
  columns: [pk('customer_id', 'uuid', 1), ck('token_id', 'uuid', 1), col('token', 'frozen<card_token>'), col('last_used', 'timestamp'), col('limits', 'frozen<list<int>>')],
  options: baseOptions,
  indexes: [],
  views: [],
}

export const transactionsByStatus: MaterializedView = {
  name: 'transactions_by_status',
  keyspace: 'payments',
  baseTable: 'transactions_by_merchant',
  columns: [
    pk('status', 'text', 1),
    pk('txn_day', 'date', 2),
    ck('merchant_id', 'uuid', 1),
    ck('txn_time', 'timeuuid', 2, 'DESC'),
    col('amount', 'decimal'),
    col('currency', 'text'),
  ],
  filter: 'IS NOT NULL on all key columns',
}

const address: Udt = {
  name: 'address',
  keyspace: 'payments',
  fields: [
    { name: 'street', type: 'text' },
    { name: 'city', type: 'text' },
    { name: 'postal_code', type: 'text' },
    { name: 'country_code', type: 'ascii' },
  ],
  usedBy: ['transactions_by_merchant.billing', 'customers.home_address'],
}
const cardToken: Udt = {
  name: 'card_token',
  keyspace: 'payments',
  fields: [
    { name: 'network', type: 'text' },
    { name: 'last4', type: 'text' },
    { name: 'expires', type: 'date' },
  ],
  usedBy: ['card_tokens.token', 'customers.tokens'],
}
const geoPoint: Udt = {
  name: 'geo_point',
  keyspace: 'payments',
  fields: [
    { name: 'lat', type: 'double' },
    { name: 'lon', type: 'double' },
  ],
  usedBy: [],
}

const inv = (name: string, columns: Column[]): Table => ({ name, keyspace: 'inventory', columns, options: baseOptions, indexes: [], views: [] })

const system = (name: string, tables: string[]): Keyspace => ({
  name,
  replication: "{'class': 'LocalStrategy'}",
  system: true,
  tables: tables.map((t) => ({
    name: t,
    keyspace: name,
    columns: [pk('key', 'text', 1), col('value', 'blob')],
    options: baseOptions,
    indexes: [],
    views: [],
  })),
  views: [],
  types: [],
  functions: [],
  aggregates: [],
})

export const keyspaces: Keyspace[] = [
  {
    name: 'payments',
    replication: "{'class': 'NetworkTopologyStrategy', 'eu-west-1': 3}",
    tables: [transactionsByMerchant, ledgerCounters, merchants, customers, cardTokens],
    views: [transactionsByStatus],
    types: [address, cardToken, geoPoint],
    functions: [{ keyspace: 'payments', name: 'minor_units', signature: 'minor_units(decimal)', argNames: ['amount'], argTypes: ['decimal'], returnType: 'bigint', language: 'java', body: 'return amount.movePointRight(2).longValue();', calledOnNull: false }],
    aggregates: [],
  },
  {
    name: 'inventory',
    replication: "{'class': 'NetworkTopologyStrategy', 'eu-west-1': 3}",
    tables: [
      inv('sku_stock', [pk('sku', 'text', 1), col('qty', 'int'), col('updated', 'timestamp')]),
      inv('warehouses', [pk('warehouse_id', 'uuid', 1), col('name', 'text'), col('capacity', 'bigint')]),
      inv('reservations', [pk('sku', 'text', 1), ck('reserved_at', 'timeuuid', 1, 'DESC'), col('qty', 'int')]),
      inv('events', [pk('sku', 'text', 1), pk('bucket', 'int', 2), ck('at', 'timestamp', 1, 'DESC'), col('payload', 'blob')]),
    ],
    views: [],
    types: [],
    functions: [],
    aggregates: [],
  },
  system('system', ['local', 'peers_v2', 'size_estimates']),
  system('system_auth', ['roles', 'role_permissions']),
  system('system_distributed', ['repair_history']),
  system('system_schema', ['tables', 'columns', 'keyspaces']),
  system('system_traces', ['sessions', 'events']),
  system('system_virtual_schema', ['tables', 'columns']),
]

export function findTable(ks: string, name: string): Table | undefined {
  return keyspaces.find((k) => k.name === ks)?.tables.find((t) => t.name === name)
}
export function findView(ks: string, name: string): MaterializedView | undefined {
  return keyspaces.find((k) => k.name === ks)?.views.find((v) => v.name === name)
}
export function findType(ks: string, name: string): Udt | undefined {
  return keyspaces.find((k) => k.name === ks)?.types.find((t) => t.name === name)
}
