import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryView } from './QueryView'

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
