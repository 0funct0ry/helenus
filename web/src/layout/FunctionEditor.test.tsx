import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FunctionEditor } from './FunctionEditor'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { Call } from '../test/api'
import type { FunctionRequest } from '../api/types'
import type { Fn } from '../lib/schemaModel'

const plan = (call: Call) => {
  const r = call.body as FunctionRequest
  const ok = !!r.name
  return { body: { statement: ok ? `${r.action === 'replace' ? 'CREATE OR REPLACE' : 'CREATE'} FUNCTION ${r.keyspace}.${r.name} (...)` : '', errors: ok ? [] : [{ field: 'name', message: 'Function name must start with a letter' }], notes: [] } }
}

const fn: Fn = { keyspace: 'payments', name: 'add_cents', signature: 'add_cents(int, int)', argNames: ['a', 'b'], argTypes: ['int', 'int'], returnType: 'int', language: 'java', body: 'return a + b;', calledOnNull: false }

describe('FunctionEditor', () => {
  let calls: Call[]
  beforeEach(() => {
    connectedWorkspace()
    calls = mockSchemaApi({ 'POST /p/local/functions/preview': plan })
  })

  it('previews live and creates the function', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<FunctionEditor keyspace="payments" serverMajor={4} onSaved={onSaved} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Create function' })).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Function name' }), 'tax')
    expect(await screen.findByText('CREATE FUNCTION payments.tax (...)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create function' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/p/local/query')?.body).toMatchObject({ cql: 'CREATE FUNCTION payments.tax (...)', ddl_origin: 'ui' })
    expect(onSaved).toHaveBeenCalledWith('tax(text)')
  })
  it('offers JavaScript only before Cassandra 5.0', () => {
    const { unmount } = render(<FunctionEditor keyspace="payments" serverMajor={4} onSaved={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: 'JavaScript' })).toBeInTheDocument()
    unmount()
    render(<FunctionEditor keyspace="payments" serverMajor={5} onSaved={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('radio', { name: 'JavaScript' })).not.toBeInTheDocument()
  })
  it('locks the name and argument types when replacing', async () => {
    render(<FunctionEditor keyspace="payments" existing={fn} serverMajor={5} onSaved={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Function name' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add argument' })).not.toBeInTheDocument()
    expect(await screen.findByText(/CREATE OR REPLACE FUNCTION payments.add_cents/)).toBeInTheDocument()
    expect(calls.filter((c) => c.path.endsWith('/functions/preview')).at(-1)?.body).toMatchObject({ action: 'replace', args: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }], body: 'return a + b;' })
  })
  it('shows the server error inline and keeps the form', async () => {
    mockSchemaApi({ 'POST /p/local/functions/preview': plan, 'POST /p/local/query': { status: 400, body: { error: { code: 'bad_request', message: 'User-defined functions are disabled' } } } })
    render(<FunctionEditor keyspace="payments" serverMajor={4} onSaved={() => {}} onClose={() => {}} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Function name' }), 'tax')
    await screen.findByText('CREATE FUNCTION payments.tax (...)')
    await userEvent.click(screen.getByRole('button', { name: 'Create function' }))
    expect(await screen.findByText('User-defined functions are disabled')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Function name' })).toHaveValue('tax')
  })
})
