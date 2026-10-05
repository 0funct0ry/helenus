import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AggregateView } from './AggregateView'
import { renderWithClient as render } from '../test/api'
import { aggregateTab as tab, connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'

describe('AggregateView', () => {
  beforeEach(() => {
    connectedWorkspace([tab])
    mockSchemaApi({
      'GET /p/local/keyspaces/payments/ddl?object=aggregate&name=total(int)': { ddl: 'CREATE AGGREGATE payments.total(int) SFUNC add_cents STYPE int INITCOND 0;' },
      'GET /p/local/deps?kind=aggregate&keyspace=payments&name=total&signature=total%28int%29': { dependents: [], dependencies: [] },
    })
  })
  it('shows the definition, test panel and DDL', async () => {
    render(<AggregateView tab={tab} />)
    expect(await screen.findByText('payments.total(int)')).toBeInTheDocument()
    expect(screen.getByText('add_cents')).toBeInTheDocument()
    expect(screen.getByText('initial condition')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Test aggregate' })).toBeInTheDocument()
    expect(await screen.findByText(/CREATE AGGREGATE payments.total/)).toBeInTheDocument()
  })
  it('opens the builder in replace mode and the drop dialog', async () => {
    render(<AggregateView tab={tab} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit aggregate' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Drop aggregate…' }))
    expect(screen.getByRole('dialog', { name: 'Drop aggregate' })).toBeInTheDocument()
  })
  it('handles unknown aggregates', async () => {
    render(<AggregateView tab={{ ...tab, object: 'nope()' }} />)
    expect(await screen.findByText('Aggregate not found.')).toBeInTheDocument()
  })
})
