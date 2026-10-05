import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FunctionTestPanel } from './FunctionTestPanel'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { Fn } from '../lib/schemaModel'

const fn: Fn = { keyspace: 'shop', name: 'add_tax', signature: 'add_tax(decimal, decimal)', argNames: ['amount', 'rate'], argTypes: ['decimal', 'decimal'], returnType: 'decimal', language: 'java', body: 'x', calledOnNull: false }

describe('FunctionTestPanel', () => {
  beforeEach(() => connectedWorkspace())

  it('runs the function with the typed arguments and shows the result', async () => {
    const calls = mockSchemaApi({ 'POST /p/local/functions/invoke': { value: '120.0', type: { name: 'decimal' }, elapsed_ms: 3.2, cql: '' } })
    render(<FunctionTestPanel fn={fn} />)
    await userEvent.type(screen.getByLabelText('Argument amount'), '100')
    await userEvent.type(screen.getByLabelText('Argument rate'), '0.2')
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByLabelText('Function result')).toHaveTextContent('120.0')
    expect(calls.find((c) => c.path === '/p/local/functions/invoke')?.body).toMatchObject({ keyspace: 'shop', name: 'add_tax', signature: 'add_tax(decimal, decimal)', args: ['100', '0.2'] })
  })
  it('shows the server error', async () => {
    mockSchemaApi({ 'POST /p/local/functions/invoke': { status: 422, body: { error: { code: 'invoke_failed', message: 'boom' } } } })
    render(<FunctionTestPanel fn={fn} />)
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
  it('takes JSON for collection arguments and blocks invalid JSON', async () => {
    mockSchemaApi()
    render(<FunctionTestPanel fn={{ ...fn, argNames: ['xs'], argTypes: ['list<int>'], signature: 'add_tax(list<int>)' }} />)
    await userEvent.type(screen.getByLabelText('Argument xs (JSON)'), '[[1,')
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })
})
