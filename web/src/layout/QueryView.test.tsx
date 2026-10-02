import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryView } from './QueryView'
import { renderWithClient as render } from '../test/api'

describe('QueryView', () => {
  it('renders toolbar, editor and results panel', () => {
    render(<QueryView />)
    expect(screen.getByRole('button', { name: /^Run\s*⌘/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run all/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'CQL editor' })).toHaveTextContent('transactions_by_merchant')
    expect(screen.getByRole('region', { name: 'Query output' })).toBeInTheDocument()
  })
  it('toggles Allow filtering and Trace', async () => {
    render(<QueryView />)
    const af = screen.getByRole('switch', { name: 'Allow filtering' })
    expect(af).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(af)
    expect(af).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Trace' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('QueryView tab state', () => {
  it('starts with the tab\'s prefilled CQL', () => {
    const tab = { id: 'q', kind: 'query' as const, title: 'q', keyspace: 'payments', object: '', closable: true, initialCql: 'SELECT * FROM payments.merchants LIMIT 100;' }
    render(<QueryView tab={tab} />)
    expect(screen.getByRole('textbox', { name: 'CQL editor' })).toHaveTextContent('SELECT * FROM payments.merchants LIMIT 100;')
  })
})
