import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'

const tabs = [
  { id: 'a', kind: 'table' as const, title: 'transactions_by_merchant', closable: true },
  { id: 'b', kind: 'query' as const, title: 'query-1.cql', closable: true },
  { id: 'c', kind: 'type' as const, title: 'address', closable: true },
]

function setup(extra: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  const props = { tabs, activeId: 'a', onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn(), ...extra }
  render(<TabBar {...props} />)
  return props
}

describe('TabBar', () => {
  it('renders every tab and marks the active one', () => {
    setup()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'transactions_by_merchant' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'address' })).toHaveAttribute('aria-selected', 'false')
  })
  it('selects on click', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('tab', { name: 'query-1.cql' }))
    expect(p.onSelect).toHaveBeenCalledWith('b')
  })
  it('closes via the close button and does not select', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Close address' }))
    expect(p.onClose).toHaveBeenCalledWith('c')
    expect(p.onSelect).not.toHaveBeenCalled()
  })
  it('creates a new tab', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'New query tab' }))
    expect(p.onNew).toHaveBeenCalled()
  })
  it('navigates with arrows and closes with Delete', async () => {
    const p = setup({ activeId: 'b' })
    screen.getByRole('tab', { name: 'query-1.cql' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(p.onSelect).toHaveBeenLastCalledWith('c')
    await userEvent.keyboard('{Delete}')
    expect(p.onClose).toHaveBeenCalledWith('b')
  })
  it('hides the close button for non-closable tabs', () => {
    setup({ tabs: [{ ...tabs[0], closable: false }], activeId: 'a' })
    expect(screen.queryByRole('button', { name: /^Close/ })).not.toBeInTheDocument()
  })
})
