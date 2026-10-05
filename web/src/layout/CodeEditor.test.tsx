import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeEditor } from './CodeEditor'

describe('CodeEditor', () => {
  it('shows the code and reports edits', async () => {
    const onChange = vi.fn()
    render(<CodeEditor value="return a;" onChange={onChange} aria-label="Function body" />)
    const box = screen.getByRole('textbox', { name: 'Function body' })
    expect(box).toHaveTextContent('return a;')
    box.focus()
    await userEvent.keyboard('x')
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('x'))
  })
  it('cannot be edited when read-only', async () => {
    const onChange = vi.fn()
    render(<CodeEditor value="return a;" readOnly onChange={onChange} aria-label="Body" />)
    screen.getByRole('textbox', { name: 'Body' }).focus()
    await userEvent.keyboard('x')
    expect(onChange).not.toHaveBeenCalled()
  })
})
