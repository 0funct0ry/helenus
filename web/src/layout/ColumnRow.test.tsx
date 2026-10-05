import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColumnRow } from './ColumnRow'
import { newColumn } from '../lib/tableDraft'

function setup(over: Partial<React.ComponentProps<typeof ColumnRow>> = {}) {
  const props = { column: newColumn('id', 'uuid'), index: 1, count: 3, udts: ['address'], onChange: vi.fn(), onRemove: vi.fn(), onMove: vi.fn(), ...over }
  render(<ul><ColumnRow {...props} /></ul>)
  return props
}

describe('ColumnRow', () => {
  it('edits the name and toggles static', async () => {
    const p = setup()
    await userEvent.type(screen.getByLabelText('Column 2 name'), 'x')
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'idx' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Column 2 static' }))
    expect(p.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ static: true }))
  })
  it('moves and removes', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Move column 2 up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move column 2 down' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove column 2' }))
    expect(p.onMove).toHaveBeenNthCalledWith(1, -1)
    expect(p.onMove).toHaveBeenNthCalledWith(2, 1)
    expect(p.onRemove).toHaveBeenCalled()
  })
  it('disables move at the ends and remove for the only column', () => {
    setup({ index: 0, count: 1 })
    expect(screen.getByRole('button', { name: 'Move column 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move column 1 down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove column 1' })).toBeDisabled()
  })
  it('shows errors', () => {
    setup({ nameError: 'Column name is required', typeError: 'Choose a type' })
    expect(screen.getByText('Column name is required')).toBeInTheDocument()
    expect(screen.getByText('Choose a type')).toBeInTheDocument()
  })
})
