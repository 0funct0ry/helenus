import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryConflictDialog } from './QueryConflictDialog'

function setup() {
  const p = { onOverwrite: vi.fn(), onSaveAsCopy: vi.fn(), onReload: vi.fn(), onCancel: vi.fn() }
  render(<QueryConflictDialog name="reports/daily" {...p} />)
  return p
}

describe('QueryConflictDialog', () => {
  it('has the title and the four choices', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'This query was changed elsewhere' })).toHaveTextContent('reports/daily')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Overwrite', 'Save as copy', 'Reload', 'Cancel']))
  })
  it('Overwrite and Save as copy act at once', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save as copy' }))
    expect(p.onOverwrite).toHaveBeenCalled()
    expect(p.onSaveAsCopy).toHaveBeenCalled()
  })
  it('Reload asks first and only then reloads', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(p.onReload).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Reload the saved text?' })).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Reload' }).at(-1) as HTMLElement)
    expect(p.onReload).toHaveBeenCalled()
  })
  it('cancelling the reload confirm keeps the dialog', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1) as HTMLElement)
    expect(p.onReload).not.toHaveBeenCalled()
    expect(p.onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'This query was changed elsewhere' })).toBeInTheDocument()
  })
  it('Cancel is the default focus', async () => {
    const p = setup()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(p.onCancel).toHaveBeenCalled()
  })
})
