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
})
