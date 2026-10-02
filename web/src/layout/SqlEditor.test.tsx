import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlEditor } from './SqlEditor'

describe('SqlEditor', () => {
  it('mounts CodeMirror with the given content', () => {
    render(<SqlEditor initialValue={'SELECT * FROM payments.merchants;'} />)
    expect(screen.getByRole('textbox', { name: 'CQL editor' })).toHaveTextContent('SELECT * FROM payments.merchants;')
  })
  it('tears down on unmount', () => {
    const { container, unmount } = render(<SqlEditor initialValue="x" />)
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
    unmount()
    expect(document.querySelector('.cm-editor')).toBeNull()
  })
})

describe('SqlEditor callbacks', () => {
  it('reports edits and runs on Mod-Enter / Shift-Mod-Enter', async () => {
    const onChange = vi.fn()
    const onRun = vi.fn()
    render(<SqlEditor initialValue="SELECT 1;" onChange={onChange} onRun={onRun} />)
    const box = screen.getByRole('textbox', { name: 'CQL editor' })
    box.focus()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ all: false, text: 'SELECT 1;' }))
    await userEvent.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ all: true }))
    await userEvent.keyboard('x')
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('x'))
  })
})
