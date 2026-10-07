import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ColumnFilterPopover } from './ColumnFilterPopover'

function setup(type: string, filter?: Parameters<typeof ColumnFilterPopover>[0]['filter']) {
  const onApply = vi.fn()
  const onClear = vi.fn()
  const onClose = vi.fn()
  const anchorRef = { current: document.body }
  render(<ColumnFilterPopover open anchorRef={anchorRef} column={{ name: 'c', type }} filter={filter} onApply={onApply} onClear={onClear} onClose={onClose} />)
  return { onApply, onClear, onClose }
}
const pick = async (op: string) => {
  await userEvent.click(screen.getByRole('button', { name: /Operator/ }))
  await userEvent.click(screen.getByRole('option', { name: op }))
}

describe('ColumnFilterPopover', () => {
  it('applies a text filter with Match case', async () => {
    const { onApply } = setup('text')
    await pick('starts with')
    await userEvent.type(screen.getByLabelText('Value'), 'ab')
    await userEvent.click(screen.getByLabelText('Match case'))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ op: 'starts', value: 'ab', value2: undefined, matchCase: true })
  })
  it('shows two inputs for between and validates numbers', async () => {
    const { onApply } = setup('int')
    await pick('between')
    await userEvent.type(screen.getByLabelText('From'), '1')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('To'), 'x')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number')
    await userEvent.clear(screen.getByLabelText('To'))
    await userEvent.type(screen.getByLabelText('To'), '5{Enter}')
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ op: 'between', value: '1', value2: '5' }))
  })
  it('validates ISO 8601 for timestamps', async () => {
    setup('timestamp')
    await userEvent.type(screen.getByLabelText('Value'), 'yesterday')
    expect(screen.getByRole('alert')).toHaveTextContent('ISO 8601')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })
  it('needs no input for boolean and null operators', async () => {
    const { onApply } = setup('boolean')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ op: 'true' }))
  })
  it('prefills from the current filter and clears', async () => {
    const { onClear } = setup('int', { op: 'gt', value: '100' })
    expect(screen.getByLabelText('Value')).toHaveValue('100')
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
  })
  it('cancels with Escape', async () => {
    const { onClose } = setup('int')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
