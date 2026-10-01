import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewsSheet } from './ViewsSheet'
import { transactionsByStatus } from '../mocks/schema'

describe('ViewsSheet', () => {
  it('lists views and opens one', async () => {
    const onOpen = vi.fn()
    render(<ViewsSheet views={[transactionsByStatus]} onOpen={onOpen} />)
    expect(screen.getByText('status, txn_day')).toBeInTheDocument()
    expect(screen.getByText('merchant_id, txn_time DESC')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onOpen).toHaveBeenCalledWith('transactions_by_status')
  })
  it('handles no views', () => {
    render(<ViewsSheet views={[]} onOpen={() => {}} />)
    expect(screen.getByText(/no materialized views/)).toBeInTheDocument()
  })
})
