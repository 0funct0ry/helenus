import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'

const tabs = [
  { id: 'a', kind: 'table' as const, title: 'transactions_by_merchant', closable: true },
  { id: 'b', kind: 'query' as const, title: 'query-1.cql', closable: true },
  { id: 'c', kind: 'type' as const, title: 'address', closable: true },
]

function setup(extra: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  const props = { tabs, activeId: 'a', onSelect: vi.fn(), onClose: vi.fn(), onCloseMany: vi.fn(), onNew: vi.fn(), ...extra }
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

  describe('dots and tooltips', () => {
    it('shows "Pending changes" for grid edits and "Unsaved changes" for dirty query text', () => {
      setup({ tabs: [{ ...tabs[0], modified: true }, { ...tabs[1], modified: true, dirty: true }] })
      expect(screen.getAllByTitle('Pending changes')).toHaveLength(1)
      expect(screen.getAllByTitle('Unsaved changes')).toHaveLength(1)
    })
    it('puts the tooltip on the tab', () => {
      setup({ tabs: [{ ...tabs[1], title: 'daily.cql', tooltip: 'reports/daily (Global)' }] })
      expect(screen.getByRole('tab', { name: 'daily.cql' })).toHaveAttribute('title', 'reports/daily (Global)')
    })
    it('lists dirty tabs in the discard dialog and closes them on "Discard and close"', async () => {
      const p = setup({ tabs: [{ ...tabs[0] }, { ...tabs[1], modified: true, dirty: true, title: 'daily.cql' }], activeId: 'a' })
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'transactions_by_merchant' }))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Close all tabs' }))
      expect(screen.getByRole('dialog', { name: 'Discard unapplied changes?' })).toHaveTextContent('daily.cql')
      await userEvent.click(screen.getByRole('button', { name: 'Discard and close' }))
      expect(p.onCloseMany).toHaveBeenCalledWith(['a', 'b'], 'a')
    })
  })

  describe('context menu', () => {
    const item = (name: string) => screen.getByRole('menuitem', { name })
    it('opens on right-click for that tab without activating it', () => {
      const p = setup()
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'query-1.cql' }))
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Close all tabs', 'Close other tabs', 'Close tabs to the left', 'Close tabs to the right'])
      expect(p.onSelect).not.toHaveBeenCalled()
      expect(screen.getByRole('tab', { name: 'transactions_by_merchant' })).toHaveAttribute('aria-selected', 'true')
    })
    it('opens on the close button and via Shift+F10', async () => {
      setup()
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Close address' }))
      expect(screen.getByRole('menu', { name: 'Tab actions' })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      screen.getByRole('tab', { name: 'address' }).focus()
      await userEvent.keyboard('{Shift>}{F10}{/Shift}')
      expect(item('Close tabs to the right')).toHaveAttribute('aria-disabled', 'true')
    })
    it('closes the tabs to the left of the target immediately', async () => {
      const p = setup()
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'query-1.cql' }))
      await userEvent.click(item('Close tabs to the left'))
      expect(p.onCloseMany).toHaveBeenCalledWith(['a'], 'b')
    })
    it('disables items with reasons for the first, last and only tab', () => {
      const { unmount } = render(<TabBar tabs={tabs} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} onCloseMany={vi.fn()} onNew={vi.fn()} />)
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'transactions_by_merchant' }))
      expect(item('Close tabs to the left')).toHaveAttribute('title', 'No tabs to the left')
      expect(item('Close tabs to the right')).not.toHaveAttribute('aria-disabled', 'true')
      unmount()
      setup({ tabs: [tabs[0]] })
      fireEvent.contextMenu(screen.getByRole('tab'))
      expect(item('Close other tabs')).toHaveAttribute('title', 'No other tabs')
      expect(item('Close tabs to the right')).toHaveAttribute('title', 'No tabs to the right')
      expect(item('Close all tabs')).not.toHaveAttribute('aria-disabled', 'true')
    })
    it('asks before discarding unapplied changes, listing only affected tabs', async () => {
      const p = setup({ tabs: tabs.map((t) => (t.id === 'c' ? { ...t, modified: true } : t)) })
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'transactions_by_merchant' }))
      await userEvent.click(item('Close other tabs'))
      expect(p.onCloseMany).not.toHaveBeenCalled()
      const dlg = screen.getByRole('dialog', { name: 'Discard unapplied changes?' })
      expect(dlg).toHaveTextContent('address')
      expect(dlg).not.toHaveTextContent('query-1.cql')
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(p.onCloseMany).not.toHaveBeenCalled()
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'transactions_by_merchant' }))
      await userEvent.click(item('Close other tabs'))
      await userEvent.click(screen.getByRole('button', { name: 'Discard and close' }))
      expect(p.onCloseMany).toHaveBeenCalledWith(['b', 'c'], 'a')
    })
  })
})
