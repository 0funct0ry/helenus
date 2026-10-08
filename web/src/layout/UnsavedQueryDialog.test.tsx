import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnsavedQueryDialog } from './UnsavedQueryDialog'

function setup() {
  const p = { onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() }
  render(<UnsavedQueryDialog title="daily.cql" {...p} />)
  return p
}

describe('UnsavedQueryDialog', () => {
  it('names the tab and focuses Save', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Save changes to daily.cql?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })
  it('Save, Don’t save and Cancel call their handlers', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Don’t save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect([p.onSave, p.onDiscard, p.onCancel].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })
  it('Escape cancels', async () => {
    const p = setup()
    await userEvent.keyboard('{Escape}')
    expect(p.onCancel).toHaveBeenCalled()
    expect(p.onSave).not.toHaveBeenCalled()
  })
})
