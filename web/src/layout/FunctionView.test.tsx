import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FunctionView } from './FunctionView'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { WorkspaceTab } from '../store/workspace'

const tab: WorkspaceTab = { id: 'function:payments.add_cents(int, int)', kind: 'function', title: 'add_cents(int, int)', keyspace: 'payments', object: 'add_cents(int, int)', closable: true }

describe('FunctionView', () => {
  beforeEach(() => {
    connectedWorkspace([tab])
    mockSchemaApi({
      'GET /p/local/keyspaces/payments/ddl?object=function&name=add_cents(int%2C%20int)': { ddl: 'CREATE FUNCTION payments.add_cents (a int, b int) ...' },
      'GET /p/local/deps?kind=function&keyspace=payments&name=add_cents&signature=add_cents%28int%2C+int%29': { dependents: [], dependencies: [] },
    })
  })
  it('shows the signature, language, body, test panel and DDL', async () => {
    render(<FunctionView tab={tab} />)
    expect(await screen.findByText('payments.add_cents(int, int)')).toBeInTheDocument()
    expect(screen.getByText('java')).toBeInTheDocument()
    expect(screen.getByText('Returns null on null input')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Function body' })).toHaveTextContent('return a + b;')
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    expect(await screen.findByText(/CREATE FUNCTION payments.add_cents/)).toBeInTheDocument()
  })
  it('opens the editor in replace mode and the drop dialog', async () => {
    render(<FunctionView tab={tab} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit function' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Drop function…' }))
    expect(screen.getByRole('dialog', { name: 'Drop function' })).toBeInTheDocument()
  })
  it('handles unknown functions', async () => {
    render(<FunctionView tab={{ ...tab, object: 'nope()' }} />)
    expect(await screen.findByText('Function not found.')).toBeInTheDocument()
  })
})
