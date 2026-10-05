import { replicationSummary, toKeyspaces } from './schema'
import { snapshot } from '../test/schemaFixture'

describe('toKeyspaces', () => {
  const ks = toKeyspaces(snapshot)
  const payments = ks.find((k) => k.name === 'payments')!

  it('maps columns to CQL type text with kind, position and order', () => {
    const txn = payments.tables.find((t) => t.name === 'transactions_by_merchant')!
    expect(txn.columns.map((c) => [c.name, c.type, c.kind, c.position, c.order])).toEqual([
      ['merchant_id', 'uuid', 'partition', 1, undefined],
      ['txn_day', 'date', 'partition', 2, undefined],
      ['txn_time', 'timeuuid', 'clustering', 1, 'DESC'],
      ['merchant_name', 'text', 'static', undefined, undefined],
      ['amount', 'decimal', 'regular', undefined, undefined],
      ['billing', 'frozen<address>', 'regular', undefined, undefined],
      ['tags', 'set<text>', 'regular', undefined, undefined],
    ])
  })
  it('turns options into a map and labels SAI indexes', () => {
    const txn = payments.tables.find((t) => t.name === 'transactions_by_merchant')!
    expect(txn.options.gc_grace_seconds).toBe('864000')
    expect(txn.indexes).toMatchObject([{ name: 'txn_by_currency_sai', column: 'currency', kind: 'Storage-attached (SAI)', badge: 'SAI' }])
  })
  it('links views to base tables and flags system keyspaces', () => {
    expect(payments.views[0]).toMatchObject({ name: 'transactions_by_status', baseTable: 'transactions_by_merchant' })
    expect(ks.filter((k) => k.system).map((k) => k.name)).toEqual(['system', 'system_auth'])
  })
  it('carries UDT usage and function signatures', () => {
    expect(payments.types[0].usedBy).toContain('merchants.hq')
    expect(payments.functions).toEqual(['add_cents(int, int)'])
  })
})

describe('replicationSummary', () => {
  it('summarises strategies', () => {
    expect(replicationSummary({ class: 'org.apache.cassandra.locator.NetworkTopologyStrategy', dc1: '3', dc2: '2' })).toBe('NTS · dc1:3, dc2:2')
    expect(replicationSummary({ class: 'org.apache.cassandra.locator.SimpleStrategy', replication_factor: '1' })).toBe('Simple · 1')
    expect(replicationSummary({ class: 'org.apache.cassandra.locator.LocalStrategy' })).toBe('Local')
    expect(replicationSummary(undefined)).toBe('')
  })
})
