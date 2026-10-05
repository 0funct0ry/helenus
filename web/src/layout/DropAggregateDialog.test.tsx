import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropAggregateDialog } from './DropAggregateDialog'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { Agg } from '../lib/schemaModel'

const agg: Agg = { keyspace: 'payments', name: 'average', signature: 'average(int)', argTypes: ['int'], stateFunc: 'state_avg', stateType: 'tuple<int, bigint>', finalFunc: 'final_avg', initCond: '(0, 0)', returnType: 'double' }

describe('DropAggregateDialog', () => {
  beforeEach(() => connectedWorkspace())

  it('requires typing the name, then drops with the planned statement', async () => {
    const calls = mockSchemaApi({ 'POST /p/local/aggregates/preview': { statement: 'DROP AGGREGATE payments.average(int);', errors: [], notes: [] } })
    const onDropped = vi.fn()
    render(<DropAggregateDialog aggregate={agg} onDropped={onDropped} onClose={() => {}} />)
    expect(await screen.findByText('DROP AGGREGATE payments.average(int);')).toBeInTheDocument()
    const drop = screen.getByRole('button', { name: 'Drop aggregate' })
    expect(drop).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), 'average')
    await userEvent.click(drop)
    await waitFor(() => expect(onDropped).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/p/local/query')?.body).toMatchObject({ cql: 'DROP AGGREGATE payments.average(int);', ddl_origin: 'ui' })
  })
  it('stays disabled and shows the error when the plan fails', async () => {
    mockSchemaApi({ 'POST /p/local/aggregates/preview': { statement: '', errors: [{ field: 'name', message: 'Aggregate average(int) not found' }], notes: [] } })
    render(<DropAggregateDialog aggregate={agg} onDropped={() => {}} onClose={() => {}} />)
    expect(await screen.findByText(/not found/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop aggregate' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
