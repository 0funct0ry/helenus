import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ElementInput } from './ElementInput'

describe('ElementInput', () => {
  it('edits a scalar in place', async () => {
    const onChange = vi.fn()
    render(<ElementInput type={{ name: 'int' }} value={1} label="Item 0" onChange={onChange} onDrill={() => {}} />)
    const box = screen.getByRole('textbox', { name: 'Item 0' })
    await userEvent.clear(box)
    await userEvent.type(box, '7')
    expect(onChange).toHaveBeenLastCalledWith(7)
  })
  it('shows a composite value as a literal on a button that drills in', async () => {
    const onDrill = vi.fn()
    render(<ElementInput type={{ name: 'list', args: [{ name: 'int' }] }} value={[1, 2]} label="Item 1" onChange={() => {}} onDrill={onDrill} />)
    const btn = screen.getByRole('button', { name: 'Item 1' })
    expect(btn).toHaveTextContent('[1, 2]')
    await userEvent.click(btn)
    expect(onDrill).toHaveBeenCalled()
  })
  it('shows null for an unset composite', () => {
    render(<ElementInput type={{ name: 'tuple', args: [{ name: 'int' }] }} value={null} label="t" onChange={() => {}} onDrill={() => {}} />)
    expect(screen.getByRole('button', { name: 't' })).toHaveTextContent('null')
  })
})
