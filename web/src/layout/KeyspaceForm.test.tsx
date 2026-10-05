import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyspaceForm } from './KeyspaceForm'
import type { KeyspaceFormValue } from './KeyspaceForm'

const value: KeyspaceFormValue = { name: 'shop', strategy: 'SimpleStrategy', rf: 2, rows: [], durable: true }

describe('KeyspaceForm', () => {
  it('renders the name read-only and reports toggles', async () => {
    const onChange = vi.fn()
    render(<KeyspaceForm value={value} onChange={onChange} errors={{}} nameReadOnly />)
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
    await userEvent.click(screen.getByText('Durable writes'))
    expect(onChange).toHaveBeenCalledWith({ durable: false })
  })
  it('shows field errors and the datacenter table for NTS', () => {
    render(<KeyspaceForm value={{ ...value, strategy: 'NetworkTopologyStrategy', rows: [{ name: 'dc1', rf: 1 }] }} onChange={vi.fn()} errors={{ name: 'Bad name' }} />)
    expect(screen.getByText('Bad name')).toBeInTheDocument()
    expect(screen.getByText('Datacenters')).toBeInTheDocument()
  })
})
