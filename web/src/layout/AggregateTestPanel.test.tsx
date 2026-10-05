import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AggregateTestPanel } from './AggregateTestPanel'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { Agg, Keyspace } from '../lib/schemaModel'

const agg: Agg = { keyspace: 'shop', name: 'average', signature: 'average(int)', argTypes: ['int'], stateFunc: 's', stateType: 'int', finalFunc: '', initCond: '', returnType: 'double' }
const ks: Keyspace = {
  name: 'shop',
  replication: '',
  tables: [{ name: 'orders', keyspace: 'shop', columns: [{ name: 'qty', type: 'int', kind: 'regular' }, { name: 'note', type: 'text', kind: 'regular' }], options: {}, indexes: [], views: [] } as unknown as Keyspace['tables'][number]],
  views: [],
  types: [],
  functions: [],
  aggregates: [agg],
}

describe('AggregateTestPanel', () => {
  beforeEach(() => connectedWorkspace())

  it('offers only columns of the argument type, states the limit and shows the result', async () => {
    const calls = mockSchemaApi({ 'POST /p/local/aggregates/test': { value: 4.5, type: { name: 'double' }, elapsed_ms: 2, cql: 'SELECT ...', limit: 1000 } })
    render(<AggregateTestPanel aggregate={agg} keyspace={ks} />)
    expect(screen.getByText(/LIMIT 1000/)).toBeInTheDocument()
    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Test table' }))
    await userEvent.click(screen.getByRole('option', { name: 'orders' }))
    await userEvent.click(screen.getByRole('button', { name: 'Column for argument 1' }))
    expect(screen.queryByRole('option', { name: 'note' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'qty' }))
    await userEvent.click(run)
    expect(await screen.findByLabelText('Aggregate result')).toHaveTextContent('result = 4.5')
    expect(calls.find((c) => c.path.endsWith('/aggregates/test'))?.body).toEqual({ keyspace: 'shop', name: 'average', signature: 'average(int)', table: 'orders', columns: ['qty'] })
  })
  it('shows the server error', async () => {
    mockSchemaApi({ 'POST /p/local/aggregates/test': { status: 422, body: { error: { code: 'test_failed', message: 'boom' } } } })
    render(<AggregateTestPanel aggregate={agg} keyspace={ks} />)
    await userEvent.click(screen.getByRole('button', { name: 'Test table' }))
    await userEvent.click(screen.getByRole('option', { name: 'orders' }))
    await userEvent.click(screen.getByRole('button', { name: 'Column for argument 1' }))
    await userEvent.click(screen.getByRole('option', { name: 'qty' }))
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
