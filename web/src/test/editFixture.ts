import type { QueryResponse } from '../api/types'

export const MERCHANT = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
export const TXN = '3f1a2b10-9d3c-11ef-8a6e-0242ac120002'
export const TXN2 = '3f1a2b10-9d3c-11ef-8a6e-0242ac120003'

const address = { name: 'address', frozen: true, udt: { keyspace: 'payments', name: 'address' } }

/** `SELECT *` on payments.transactions_by_merchant with two rows and the full primary key. */
export function txnResponse(over: Partial<QueryResponse> = {}): QueryResponse {
  return {
    kind: 'rows',
    executed_cql: 'SELECT * FROM payments.transactions_by_merchant;',
    columns: [
      { name: 'merchant_id', type: { name: 'uuid' }, kind: 'partition', position: 1 },
      { name: 'txn_day', type: { name: 'date' }, kind: 'partition', position: 2 },
      { name: 'txn_time', type: { name: 'timeuuid' }, kind: 'clustering', position: 1, order: 'DESC' },
      { name: 'merchant_name', type: { name: 'text' }, kind: 'static' },
      { name: 'amount', type: { name: 'decimal' }, kind: 'regular' },
      { name: 'billing', type: address, kind: 'regular' },
      { name: 'tags', type: { name: 'set', args: [{ name: 'text' }] }, kind: 'regular' },
    ],
    rows: [
      [MERCHANT, '2026-09-30', TXN, 'Acme', '1180.00', { street: '1 Main St', postal_code: '411001' }, ['gold']],
      [MERCHANT, '2026-09-30', TXN2, 'Acme', '49.99', null, null],
    ],
    has_more: false,
    warnings: [],
    timing: { client_ms: 3 },
    ...over,
  }
}

/** `SELECT *` on payments.ledger_counters. */
export function counterResponse(): QueryResponse {
  return {
    kind: 'rows',
    executed_cql: 'SELECT * FROM payments.ledger_counters;',
    columns: [
      { name: 'account_id', type: { name: 'uuid' }, kind: 'partition', position: 1 },
      { name: 'day', type: { name: 'date' }, kind: 'clustering', position: 1, order: 'DESC' },
      { name: 'debits', type: { name: 'counter' }, kind: 'regular' },
    ],
    rows: [[MERCHANT, '2026-09-30', '10']],
    has_more: false,
    warnings: [],
    timing: { client_ms: 2 },
  }
}
