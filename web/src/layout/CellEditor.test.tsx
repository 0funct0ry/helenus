import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CellEditor } from './CellEditor'
import type { TypeDesc } from '../api/types'

function setup(type: TypeDesc, initial = '', counter = false) {
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  const onInvalid = vi.fn()
  render(
    <>
      <CellEditor name="col" type={type} initial={initial} counter={counter} onCommit={onCommit} onCancel={onCancel} onInvalid={onInvalid} />
      <button>elsewhere</button>
    </>,
  )
  return { onCommit, onCancel, onInvalid, box: screen.getByRole('textbox', { name: 'Edit col' }) }
}

describe('CellEditor', () => {
  it('opens focused with the current text', () => {
    const { box } = setup({ name: 'text' }, 'SETTLED')
    expect(box).toHaveFocus()
    expect(box).toHaveValue('SETTLED')
  })
  it('commits a valid value on Enter, encoded for its type', async () => {
    const { box, onCommit } = setup({ name: 'bigint' }, '1')
    await userEvent.clear(box)
    await userEvent.type(box, '9007199254740993{Enter}')
    expect(onCommit).toHaveBeenCalledWith({ kind: 'value', value: '9007199254740993' })
  })
  it('keeps editing and reports the problem when the text is invalid', async () => {
    const { box, onCommit, onInvalid } = setup({ name: 'int' }, '1')
    await userEvent.clear(box)
    await userEvent.type(box, 'abc{Enter}')
    expect(onCommit).not.toHaveBeenCalled()
    expect(onInvalid).toHaveBeenLastCalledWith('Enter a whole number')
  })
  it('cancels on Escape without committing', async () => {
    const { box, onCommit, onCancel } = setup({ name: 'text' }, 'a')
    await userEvent.type(box, 'b{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
  it('commits valid text when the cell loses focus and discards invalid text', async () => {
    const a = setup({ name: 'text' }, 'a')
    await userEvent.type(a.box, 'b')
    await userEvent.click(screen.getAllByText('elsewhere')[0])
    expect(a.onCommit).toHaveBeenCalledWith({ kind: 'value', value: 'ab' })
  })
  it('discards invalid text on blur', async () => {
    const { box, onCommit, onCancel } = setup({ name: 'int' }, '1')
    await userEvent.type(box, 'x')
    await userEvent.click(screen.getByText('elsewhere'))
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })
  it('cancels instead of committing when nothing changed', async () => {
    const { onCommit, onCancel } = setup({ name: 'text' }, 'same')
    await userEvent.click(screen.getByText('elsewhere'))
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })
  it('clears a non-text cell when the text is emptied', async () => {
    const { box, onCommit } = setup({ name: 'int' }, '5')
    await userEvent.clear(box)
    await userEvent.type(box, '{Enter}')
    expect(onCommit).toHaveBeenCalledWith({ kind: 'null' })
  })
  it('keeps an emptied text cell as the empty string and offers Set null for null', async () => {
    const { box, onCommit } = setup({ name: 'text' }, 'x')
    await userEvent.clear(box)
    await userEvent.type(box, '{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith({ kind: 'value', value: '' })
  })
  it('sets null from the button', async () => {
    const { onCommit } = setup({ name: 'text' }, 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Set null' }))
    expect(onCommit).toHaveBeenCalledWith({ kind: 'null' })
  })
  it('takes only an increment for a counter', async () => {
    const { box, onCommit } = setup({ name: 'counter' }, '', true)
    expect(screen.queryByRole('button', { name: 'Set null' })).not.toBeInTheDocument()
    await userEvent.type(box, '-3{Enter}')
    expect(onCommit).toHaveBeenCalledWith({ kind: 'delta', value: '-3' })
  })
  it('rejects a non-numeric counter increment', async () => {
    const { box, onCommit, onInvalid } = setup({ name: 'counter' }, '', true)
    await userEvent.type(box, 'five{Enter}')
    expect(onCommit).not.toHaveBeenCalled()
    expect(onInvalid).toHaveBeenLastCalledWith('Enter a whole number')
  })
})
