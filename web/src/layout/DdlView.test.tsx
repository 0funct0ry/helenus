import { render, screen } from '@testing-library/react'
import { DdlView } from './DdlView'
import { tableDdl } from '../lib/ddl'
import { transactionsByMerchant } from '../mocks/schema'

describe('DdlView', () => {
  it('renders DDL text and actions', () => {
    const ddl = tableDdl(transactionsByMerchant)
    render(<DdlView ddl={ddl} />)
    expect(screen.getByLabelText('DDL')).toHaveTextContent('CREATE TABLE payments.transactions_by_merchant')
    expect(ddl).toContain('PRIMARY KEY ((merchant_id, txn_day), txn_time)')
    expect(ddl).toContain('CLUSTERING ORDER BY (txn_time DESC)')
    expect(screen.getByRole('button', { name: /Copy DDL/ })).toBeInTheDocument()
  })
})
