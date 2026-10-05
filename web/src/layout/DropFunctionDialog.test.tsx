import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropFunctionDialog } from './DropFunctionDialog'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { Fn } from '../lib/schemaModel'

const fn: Fn = { keyspace: 'payments', name: 'add_cents', signature: 'add_cents(int, int)', argNames: ['a', 'b'], argTypes: ['int', 'int'], returnType: 'int', language: 'java', body: 'return a + b;', calledOnNull: false }

describe('DropFunctionDialog', () => {
  beforeEach(() => connectedWorkspace())

  it('is blocked while an aggregate uses the function', async () => {
    mockSchemaApi({ 'POST /p/local/functions/preview': { statement: '', errors: [{ field: 'name', message: 'Function add_cents(int, int) is used by aggregate total' }], notes: [] } })
    render(<DropFunctionDialog fn={fn} onDropped={() => {}} onClose={() => {}} />)
    expect(await screen.findByText(/used by aggregate total/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop function' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('requires typing the name, then drops with the planned statement', async () => {
    const calls = mockSchemaApi({ 'POST /p/local/functions/preview': { statement: 'DROP FUNCTION payments.add_cents(int, int);', errors: [], notes: [] } })
    const onDropped = vi.fn()
    render(<DropFunctionDialog fn={fn} onDropped={onDropped} onClose={() => {}} />)
    expect(await screen.findByText('DROP FUNCTION payments.add_cents(int, int);')).toBeInTheDocument()
    const drop = screen.getByRole('button', { name: 'Drop function' })
    expect(drop).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), 'add_cents')
    await userEvent.click(drop)
    await waitFor(() => expect(onDropped).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/p/local/query')?.body).toMatchObject({ cql: 'DROP FUNCTION payments.add_cents(int, int);', ddl_origin: 'ui' })
  })
})
