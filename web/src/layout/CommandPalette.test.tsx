import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from './CommandPalette'
import { useWorkspace } from '../store/workspace'

describe('CommandPalette', () => {
  beforeEach(() => useWorkspace.setState({ paletteOpen: true }))

  it('is hidden when closed', () => {
    useWorkspace.setState({ paletteOpen: false })
    render(<CommandPalette />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('filters actions', async () => {
    render(<CommandPalette />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Command' }), 'ledger')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('payments.ledger_counters')
  })
  it('runs the highlighted action with Enter and closes', async () => {
    render(<CommandPalette />)
    await userEvent.type(screen.getByRole('combobox'), 'ledger{Enter}')
    expect(useWorkspace.getState().activeId).toBe('table:payments.ledger_counters')
    expect(useWorkspace.getState().paletteOpen).toBe(false)
  })
  it('closes on Escape', async () => {
    render(<CommandPalette />)
    await userEvent.keyboard('{Escape}')
    expect(useWorkspace.getState().paletteOpen).toBe(false)
  })
  it('shows an empty state', async () => {
    render(<CommandPalette />)
    await userEvent.type(screen.getByRole('combobox'), 'zzzzz')
    expect(screen.getByText('No matching commands')).toBeInTheDocument()
  })
})
