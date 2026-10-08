import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CloseTabsDialog } from './CloseTabsDialog'

function setup(titles: string[]) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<CloseTabsDialog open titles={titles} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('CloseTabsDialog', () => {
  it('lists the titles and focuses Cancel', () => {
    setup(['a', 'b'])
    expect(screen.getByRole('dialog', { name: 'Discard unapplied changes?' })).toHaveTextContent('These tabs have changes that have not been applied and will be lost:')
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['a', 'b'])
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })
  it('shows at most 8 titles then "and N more"', () => {
    setup(Array.from({ length: 11 }, (_, i) => `t${i}`))
    expect(screen.getAllByRole('listitem')).toHaveLength(9)
    expect(screen.getByText('and 3 more')).toBeInTheDocument()
  })
  it('Enter on the initial focus cancels, not confirms', async () => {
    const p = setup(['a'])
    await userEvent.keyboard('{Enter}')
    expect(p.onConfirm).not.toHaveBeenCalled()
    expect(p.onCancel).toHaveBeenCalled()
  })
  it('confirms from the danger button with Enter', async () => {
    const p = setup(['a'])
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(p.onConfirm).toHaveBeenCalled()
  })
  it('Escape dismisses', async () => {
    const p = setup(['a'])
    await userEvent.keyboard('{Escape}')
    expect(p.onCancel).toHaveBeenCalled()
    expect(p.onConfirm).not.toHaveBeenCalled()
  })
})
