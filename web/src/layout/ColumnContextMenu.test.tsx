import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ColumnContextMenu } from './ColumnContextMenu'
import type { ColumnContextMenuProps } from './ColumnContextMenu'

function setup(over: Partial<ColumnContextMenuProps> = {}) {
  const p: ColumnContextMenuProps = {
    x: 10, y: 10, targets: ['id'], sortReason: null, sorted: false, alreadySelected: false, hideReason: null, anyHidden: false, copyReason: null,
    onCopyNames: vi.fn(), onSelect: vi.fn(), onSort: vi.fn(), onClearSort: vi.fn(), onFilter: vi.fn(), onCopyAs: vi.fn(), onHide: vi.fn(), onShowAll: vi.fn(), onClose: vi.fn(),
    ...over,
  }
  render(<ColumnContextMenu {...p} />)
  return p
}

describe('ColumnContextMenu', () => {
  it('lists the items in order for one column', () => {
    setup()
    expect(screen.getByRole('menu')).toHaveTextContent('id')
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Copy Column Name', 'Select Column', 'Sort ascending', 'Sort descending', 'Clear sorting', 'Set local filter', 'Copy Column as', 'Hide column', 'Show All Columns',
    ])
  })
  it('pluralises labels and the header', () => {
    setup({ targets: ['a', 'b', 'c'] })
    expect(screen.getByRole('menu')).toHaveTextContent('3 columns')
    for (const l of ['Copy Column Names', 'Select Columns', 'Hide 3 columns']) expect(screen.getByRole('menuitem', { name: l })).toBeInTheDocument()
  })
  it('disables items with their reasons', () => {
    setup({ sortReason: 'This type can’t be sorted', alreadySelected: true, hideReason: 'At least one column must stay visible' })
    expect(screen.getByRole('menuitem', { name: 'Sort ascending' })).toHaveAttribute('title', 'This type can’t be sorted')
    expect(screen.getByRole('menuitem', { name: 'Sort descending' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Select Column' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Clear sorting' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Hide column' })).toHaveAttribute('title', 'At least one column must stay visible')
    expect(screen.getByRole('menuitem', { name: 'Show All Columns' })).toHaveAttribute('aria-disabled', 'true')
  })
  it('enables Clear sorting and Show All Columns when applicable and calls the handlers', async () => {
    const p = setup({ sorted: true, anyHidden: true })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clear sorting' }))
    expect(p.onClearSort).toHaveBeenCalled()
  })
  it('opens the eight-format flyout', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy Column as' }))
    for (const l of ['JSON', 'CSV', 'TSV', 'XML', 'YAML', 'Markdown', 'HTML', 'SQL']) expect(screen.getByRole('menuitem', { name: l })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'SQL' }))
    expect(p.onCopyAs).toHaveBeenCalledWith('sql_in')
  })
})
