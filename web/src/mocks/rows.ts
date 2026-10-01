import { transactionsByMerchant } from './schema'
import type { Column, Row } from './types'

export const dataColumns: Column[] = transactionsByMerchant.columns.slice(0, 10)

const times = ['e1b4c6a0', 'd9f2a1c0', 'd4118b20', 'cf7a3e00', 'c9e0b8a0', 'a2c77e40', '9f13d5c0', '98a2f060', '92f41c80', '8b61e7a0', '85b3d940', '7ff0c1e0']
const amounts = ['49.99', '1180.00', '24.50', '310.75', '9.99', '5400.00', '72.30', '18.00', '260.40', '1099.00', '35.25', '88.80']
const statuses = ['PENDING', 'SETTLED', 'SETTLED', 'AUTHORIZED', 'SETTLED', 'REFUNDED', 'SETTLED', 'DECLINED', 'SETTLED', 'SETTLED', 'CHARGEBACK', 'SETTLED']
const tags: (string | null)[] = ["{'manual'}", "{'card_present', 'contactless'}", "{'recurring'}", null, "{'card_present'}", "{'refund', 'ops_review'}", "{'ecom'}", "{'ecom', 'risk_hold'}", null, "{'ecom', '3ds'}", "{'dispute'}", "{'card_present'}"]

export const dataRows: Row[] = times.map((t, i) => ({
  merchant_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  txn_day: '2026-09-30',
  txn_time: `${t}-9c9d-11f1-8b3a-0242ac120002`,
  merchant_name: 'Northwind Coffee',
  amount: amounts[i],
  currency: 'EUR',
  status: statuses[i],
  tags: tags[i],
  metadata: i % 3 === 2 ? "{'channel': 'pos', 'terminal_id': 'T-88213', 'risk_score': '0.12'}" : i % 3 === 0 ? "{'channel': 'ecom'}" : null,
  billing: i % 4 === 1 ? "{street: '12 Quay St', city: 'Dublin', postal_code: 'D02 X285', country_code: 'IE'}" : null,
}))

export const queryColumns: Column[] = transactionsByMerchant.columns.filter((c) =>
  ['txn_time', 'amount', 'currency', 'status', 'tags'].includes(c.name),
)

export const queryRows: Row[] = dataRows.slice(0, 6).map((r) => ({
  txn_time: r.txn_time,
  amount: r.amount,
  currency: r.currency,
  status: r.status,
  tags: r.tags,
}))

export const sampleQuery = `-- Today's activity for one merchant
USE payments;

SELECT txn_time, amount, currency, status, tags
FROM payments.transactions_by_merchant
WHERE merchant_id = 7c9e6679-7425-40de-944b-e07fc1f90ae7
  AND txn_day = '2026-09-30'
LIMIT 50;
`

/** Deterministic plausible values for any column list, used where no hand-written fixture exists. */
export function generateRows(columns: Column[], count = 8): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const row: Row = {}
    for (const c of columns) {
      const t = c.type.replace(/^frozen<(.*)>$/, '$1')
      const hex = (i * 2654435761 + 40503).toString(16).padStart(8, '0').slice(-8)
      if (c.kind === 'regular' && i % 5 === 4) row[c.name] = null
      else if (t === 'uuid' || t === 'timeuuid') row[c.name] = `${hex}-7425-40de-944b-e07fc1f90a${(10 + i).toString(16)}`
      else if (t === 'text' || t === 'ascii' || t === 'varchar') row[c.name] = `${c.name}-${i + 1}`
      else if (t === 'int' || t === 'bigint' || t === 'smallint') row[c.name] = 100 * (i + 1) + 7
      else if (t === 'counter') row[c.name] = 1000 * (i + 1)
      else if (t === 'decimal' || t === 'double' || t === 'float') row[c.name] = (12.5 * (i + 1)).toFixed(2)
      else if (t === 'timestamp') row[c.name] = `2026-09-${String(10 + i).padStart(2, '0')} 08:15:00+0000`
      else if (t === 'date') row[c.name] = `2026-09-${String(10 + i).padStart(2, '0')}`
      else if (t === 'blob') row[c.name] = `0x${hex}… (${64 * (i + 1)} B)`
      else if (/^list/.test(t)) row[c.name] = `['a${i}', 'b${i}']`
      else if (/^set/.test(t)) row[c.name] = `{'a${i}', 'b${i}'}`
      else if (/^map/.test(t)) row[c.name] = `{'k${i}': 'v${i}'}`
      else row[c.name] = `{field: 'v${i}'}`
    }
    return row
  })
}
