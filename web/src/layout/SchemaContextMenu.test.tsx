import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SchemaContextMenu } from './SchemaContextMenu'

function setup() {
  const onClose = vi.fn()
  const a = vi.fn()
  const b = vi.fn()
  render(
    <SchemaContextMenu
      x={10}
      y={10}
      label="payments.t"
      onClose={onClose}
      items={[
        { label: 'Open', onSelect: a },
        { label: 'Copy name', onSelect: b },
      ]}
    />,
  )
  return { onClose, a, b }
}

describe('SchemaContextMenu', () => {
  it('lists items and focuses the first', () => {
    setup()
    expect(screen.getByRole('menu', { name: 'payments.t' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus()
  })
  it('runs an item and closes', async () => {
    const { a, onClose } = setup()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(a).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
  it('moves with arrows and picks with Enter', async () => {
    const { b } = setup()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Copy name' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(b).toHaveBeenCalled()
  })
  it('closes on Escape and on outside press', async () => {
    const { onClose } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  describe('flyout, disabled items and header', () => {
    function flyout() {
      const onClose = vi.fn()
      const csv = vi.fn()
      const del = vi.fn()
      render(
        <SchemaContextMenu
          x={10}
          y={10}
          label="Row actions"
          header="3 rows"
          onClose={onClose}
          items={[
            { label: 'Delete 3 rows', onSelect: del, disabled: true, disabledReason: 'Views are read-only' },
            { label: 'Copy As', separatorBefore: true, children: [{ label: 'JSON' }, { label: 'CSV', onSelect: csv }, { label: 'SQL Inserts', disabled: true, disabledReason: 'No single table' }] },
          ]}
        />,
      )
      return { onClose, csv, del }
    }
    it('shows the header and skips disabled items on open', () => {
      flyout()
      expect(screen.getByText('3 rows')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Copy As' })).toHaveFocus()
    })
    it('does not run a disabled item and shows its reason as a tooltip', async () => {
      const { del, onClose } = flyout()
      const item = screen.getByRole('menuitem', { name: 'Delete 3 rows' })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveAttribute('title', 'Views are read-only')
      await userEvent.click(item)
      expect(del).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
    it('opens the flyout with Right, closes it with Left and picks with Enter', async () => {
      const { csv, onClose } = flyout()
      await userEvent.keyboard('{ArrowRight}')
      expect(await screen.findByRole('menuitem', { name: 'JSON' })).toBeInTheDocument()
      await userEvent.keyboard('{ArrowLeft}')
      expect(screen.queryByRole('menuitem', { name: 'JSON' })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Copy As' })).toHaveFocus()
      await userEvent.keyboard('{ArrowRight}{ArrowDown}{Enter}')
      expect(csv).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
    it('opens the flyout on hover and disables flyout items with a reason', async () => {
      const { csv } = flyout()
      await userEvent.hover(screen.getByRole('menuitem', { name: 'Copy As' }))
      const sql = await screen.findByRole('menuitem', { name: 'SQL Inserts' })
      expect(sql).toHaveAttribute('title', 'No single table')
      await userEvent.click(sql)
      expect(csv).not.toHaveBeenCalled()
    })
  })
})
