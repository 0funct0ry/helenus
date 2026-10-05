import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AggregateBuilder } from './AggregateBuilder'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { Call } from '../test/api'
import type { AggregateRequest } from '../api/types'
import type { Agg } from '../lib/schemaModel'

const need = 'Needs (int, int) → int'
const candidates = { candidates: [
  { name: 'add_cents', signature: 'add_cents(int, int)', returns: 'int', ok: true },
  { name: 'other', signature: 'other(text)', returns: 'text', ok: false, reason: need },
] }
const plan = (call: Call) => {
  const r = call.body as AggregateRequest
  const ok = !!r.name && !!r.sfunc
  const bad = r.initcond === 'x'
  return { body: { statement: ok && !bad ? `CREATE AGGREGATE payments.${r.name} (int) SFUNC ${r.sfunc} STYPE ${r.stype};` : '', errors: bad ? [{ field: 'initcond', message: 'INITCOND does not match state type int' }] : [], notes: [] } }
}
const existing: Agg = { keyspace: 'payments', name: 'total', signature: 'total(int)', argTypes: ['int'], stateFunc: 'add_cents', stateType: 'int', finalFunc: '', initCond: '0', returnType: 'int' }

describe('AggregateBuilder', () => {
  let calls: Call[]
  beforeEach(() => {
    connectedWorkspace()
    calls = mockSchemaApi({ 'POST /p/local/aggregates/preview': plan, 'POST /p/local/aggregates/candidates': candidates })
  })

  it('disables functions with the wrong signature and creates the aggregate', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<AggregateBuilder keyspace="payments" onSaved={onSaved} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Create aggregate' })).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Aggregate name' }), 'total')
    await userEvent.click(await screen.findByRole('button', { name: 'State function' }))
    expect(await screen.findByRole('option', { name: /other\(text\)/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /Needs \(int, int\) → int/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /add_cents\(int, int\)/ }))
    expect(await screen.findByText('CREATE AGGREGATE payments.total (int) SFUNC add_cents STYPE int;')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create aggregate' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/p/local/query')?.body).toMatchObject({ ddl_origin: 'ui' })
    expect(onSaved).toHaveBeenCalledWith('total(int)')
  })
  it('opens the function editor prefilled with the needed signature', async () => {
    render(<AggregateBuilder keyspace="payments" onSaved={() => {}} onClose={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Create function…' })[0])
    expect(await screen.findByRole('dialog', { name: 'New function' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Argument 1 name' })).toHaveValue('state')
    expect(screen.getByRole('textbox', { name: 'Argument 2 name' })).toHaveValue('val1')
  })
  it('locks the name and argument types when replacing', async () => {
    render(<AggregateBuilder keyspace="payments" existing={existing} onSaved={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Aggregate name' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add argument' })).not.toBeInTheDocument()
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/aggregates/preview')).at(-1)?.body).toMatchObject({ action: 'replace', arg_types: ['int'], sfunc: 'add_cents', initcond: 0 }))
  })
})
