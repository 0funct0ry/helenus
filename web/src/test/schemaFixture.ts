import { mockApi } from './api'
import type { Call } from './api'
import { useWorkspace } from '../store/workspace'
import type { SchemaColumn, SchemaKeyspace, SchemaSnapshot, SchemaTable, TypeDesc } from '../api/types'
import type { WorkspaceTab } from '../store/workspace'

const t = (name: string): TypeDesc => ({ name })
const col = (name: string, cql: string, kind: SchemaColumn['kind'] = 'regular', position?: number, order?: 'ASC' | 'DESC'): SchemaColumn => ({
  name,
  cql,
  type: t(cql),
  kind,
  position,
  order,
})
const table = (keyspace: string, name: string, columns: SchemaColumn[], over: Partial<SchemaTable> = {}): SchemaTable => ({
  keyspace,
  name,
  columns,
  options: [
    { name: 'gc_grace_seconds', value: '864000' },
    { name: 'default_time_to_live', value: '7776000' },
  ],
  indexes: [],
  views: [],
  ...over,
})
const emptyKs = (name: string, over: Partial<SchemaKeyspace> = {}): SchemaKeyspace => ({
  name,
  system: false,
  replication: { class: 'org.apache.cassandra.locator.NetworkTopologyStrategy', 'eu-west-1': '3' },
  durable_writes: true,
  tables: [],
  views: [],
  types: [],
  functions: [],
  aggregates: [],
  ...over,
})

const txnColumns = [
  col('merchant_id', 'uuid', 'partition', 1),
  col('txn_day', 'date', 'partition', 2),
  col('txn_time', 'timeuuid', 'clustering', 1, 'DESC'),
  col('merchant_name', 'text', 'static'),
  col('amount', 'decimal'),
  col('billing', 'frozen<address>'),
  col('tags', 'set<text>'),
]

/** A small cluster: payments (3 tables, an MV on the first, one UDT), inventory, and system keyspaces. */
export const snapshot: SchemaSnapshot = {
  version: '5.0.2',
  generated_at: '2026-10-01T00:00:00Z',
  keyspaces: [
    emptyKs('inventory', { tables: [table('inventory', 'sku_stock', [col('sku', 'text', 'partition', 1), col('qty', 'int')])] }),
    emptyKs('payments', {
      tables: [
        table('payments', 'ledger_counters', [col('account_id', 'uuid', 'partition', 1), col('day', 'date', 'clustering', 1, 'DESC'), col('debits', 'counter')], { counter: true }),
        table('payments', 'merchants', [col('merchant_id', 'uuid', 'partition', 1), col('name', 'text'), col('hq', 'frozen<address>')]),
        table('payments', 'transactions_by_merchant', txnColumns, {
          views: ['transactions_by_status'],
          indexes: [{ name: 'txn_by_currency_sai', kind: 'custom', target: 'currency', column: 'currency', sai: true, class: 'StorageAttachedIndex' }],
        }),
      ],
      views: [
        {
          keyspace: 'payments',
          name: 'transactions_by_status',
          base_table: 'transactions_by_merchant',
          columns: [col('status', 'text', 'partition', 1), col('merchant_id', 'uuid', 'clustering', 1, 'ASC'), col('txn_time', 'timeuuid', 'clustering', 2, 'DESC'), col('amount', 'decimal')],
          options: [],
          where_clause: 'status IS NOT NULL AND merchant_id IS NOT NULL',
          include_all_columns: false,
        },
      ],
      types: [
        {
          keyspace: 'payments',
          name: 'address',
          fields: [
            { name: 'street', type: t('text'), cql: 'text' },
            { name: 'postal_code', type: t('text'), cql: 'text' },
          ],
          used_by: ['merchants.hq', 'transactions_by_merchant.billing'],
        },
      ],
      functions: [{ keyspace: 'payments', name: 'add_cents', arg_types: ['int', 'int'], return_type: 'int' }],
    }),
    emptyKs('system', { system: true, tables: [table('system', 'local', [col('key', 'text', 'partition', 1)])] }),
    emptyKs('system_auth', { system: true }),
  ],
}

export const DDL = 'CREATE TABLE payments.transactions_by_merchant (\n    merchant_id uuid,\n    PRIMARY KEY (merchant_id)\n);'

/** Mock the schema and DDL routes for profile `local`. Returns the recorded calls. */
export function mockSchemaApi(extra: Record<string, unknown> = {}): Call[] {
  return mockApi({
    'GET /p/local/schema': snapshot,
    'POST /p/local/schema/refresh': snapshot,
    'GET /p/local/keyspaces/payments/ddl?object=table&name=transactions_by_merchant': { ddl: DDL },
    'GET /p/local/keyspaces/payments/ddl?object=view&name=transactions_by_status': { ddl: 'CREATE MATERIALIZED VIEW payments.transactions_by_status AS SELECT 1;' },
    'GET /p/local/keyspaces/payments/ddl?object=type&name=address': { ddl: 'CREATE TYPE payments.address (\n    street text\n);' },
    ...extra,
  })
}

/** Put the workspace into "profile `local` is connected" with the given tabs open. */
export function connectedWorkspace(tabs: WorkspaceTab[] = [], activeId = tabs[0]?.id ?? '') {
  useWorkspace.setState({
    tabs,
    activeId,
    profileId: 'local',
    connections: { local: { status: 'connected' } },
    paletteOpen: false,
    profileDialogOpen: false,
    queryCount: 0,
  })
}

export const tableTab: WorkspaceTab = { id: 'table:payments.transactions_by_merchant', kind: 'table', title: 'transactions_by_merchant', keyspace: 'payments', object: 'transactions_by_merchant', closable: true }
export const viewTab: WorkspaceTab = { id: 'view:payments.transactions_by_status', kind: 'view', title: 'transactions_by_status', keyspace: 'payments', object: 'transactions_by_status', closable: true }
export const typeTab: WorkspaceTab = { id: 'type:payments.address', kind: 'type', title: 'address', keyspace: 'payments', object: 'address', closable: true }
export const queryTab: WorkspaceTab = { id: 'query-1', kind: 'query', title: 'query-1.cql', keyspace: 'payments', object: '', closable: true }
