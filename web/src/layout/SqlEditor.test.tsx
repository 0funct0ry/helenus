import { render, screen } from '@testing-library/react'
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
