import { screen } from '@testing-library/react'
import { mockApi, renderWithClient } from '../test/api'
import { ReviewDataModelDialog } from './ReviewDataModelDialog'

describe('ReviewDataModelDialog', () => {
  beforeEach(() => localStorage.clear())
  it('shows findings across tables', async () => {
    mockApi({ 'GET /p/local/advise?keyspace=shop': { findings: [{ id: 'A009', severity: 'warning', message: 'A single node failure makes data unavailable', help_url: '/x#a009', keyspace: 'shop' }] } })
    renderWithClient(<ReviewDataModelDialog profile="local" keyspace="shop" onClose={() => {}} />)
    expect(await screen.findByRole('note')).toHaveTextContent('single node failure')
  })
  it('renders nothing when closed', () => {
    renderWithClient(<ReviewDataModelDialog profile="local" keyspace={null} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
