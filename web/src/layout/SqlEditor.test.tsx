import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('SqlEditor save keys', () => {
  it('calls onSave on Mod-s and onSaveAs on Shift-Mod-s and prevents the browser default', async () => {
    const onSave = vi.fn()
    const onSaveAs = vi.fn()
    render(<SqlEditor initialValue="SELECT 1;" onSave={onSave} onSaveAs={onSaveAs} />)
    screen.getByRole('textbox', { name: 'CQL editor' }).focus()
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSaveAs).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'CQL editor' }), { key: 'S', keyCode: 83, ctrlKey: true, shiftKey: true })
    expect(onSaveAs).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

describe('SqlEditor completion', () => {
  it('asks the server with the profile and keyspace while typing', async () => {
    const calls: { path: string; body: unknown }[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ from: 0, items: [{ label: 'SELECT', kind: 'keyword', insert: 'SELECT' }] }), { status: 200 })
    }) as typeof fetch
    render(<SqlEditor initialValue="" profile="local" keyspace="payments" />)
    const box = screen.getByRole('textbox', { name: 'CQL editor' })
    box.focus()
    await userEvent.keyboard('s')
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls[0].path).toBe('/api/v1/p/local/complete')
    expect(calls[0].body).toMatchObject({ text: 's', cursor: 1, keyspace: 'payments' })
  })
})
