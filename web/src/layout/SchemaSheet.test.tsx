import { render, screen } from '@testing-library/react'
import { SchemaSheet } from './SchemaSheet'
import { transactionsByMerchant as t } from '../mocks/schema'

describe('SchemaSheet', () => {
  it('shows key layout, columns, options and indexes', () => {
    render(<SchemaSheet columns={t.columns} options={t.options} indexes={t.indexes} />)
    expect(screen.getByRole('heading', { name: 'Primary key' })).toBeInTheDocument()
    expect(screen.getAllByLabelText(/Partition key/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('risk_embedding')).toBeInTheDocument()
    expect(screen.getByText('gc_grace_seconds')).toBeInTheDocument()
    expect(screen.getByText('txn_by_currency_sai')).toBeInTheDocument()
  })
})
