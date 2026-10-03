import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListEditor } from './ListEditor'
import { Stateful, renderEditor } from '../test/editors'
import type { TypeDesc } from '../api/types'

const text: TypeDesc = { name: 'list', args: [{ name: 'text' }] }

function setup(initial: unknown[], type = text, onDrill = vi.fn()) {
  const seen: unknown[][] = []
  renderEditor(
    <Stateful<unknown[]> initial={initial} onValue={(v) => seen.push(v)}>
      {(v, set) => <ListEditor type={type} value={v} onChange={set} onDrill={onDrill} />}
    </Stateful>,
  )
  return { seen, onDrill }
}

describe('ListEditor', () => {
  it('lists the elements in order', () => {
    setup(['a', 'b'])
    expect(screen.getByRole('textbox', { name: 'Item 0' })).toHaveValue('a')
    expect(screen.getByRole('textbox', { name: 'Item 1' })).toHaveValue('b')
  })
  it('adds an item and edits it', async () => {
    const { seen } = setup(['a'])
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Item 1' }), 'z')
    expect(seen.at(-1)).toEqual(['a', 'z'])
  })
  it('removes an item', async () => {
    const { seen } = setup(['a', 'b', 'c'])
    await userEvent.click(screen.getByRole('button', { name: 'Remove item 1' }))
    expect(seen.at(-1)).toEqual(['a', 'c'])
  })
  it('moves items up and down and stops at the ends', async () => {
    const { seen } = setup(['a', 'b', 'c'])
    expect(screen.getByRole('button', { name: 'Move item 0 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move item 2 down' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Move item 0 down' }))
    expect(seen.at(-1)).toEqual(['b', 'a', 'c'])
    await userEvent.click(screen.getByRole('button', { name: 'Move item 2 up' }))
    expect(seen.at(-1)).toEqual(['b', 'c', 'a'])
  })
  it('reorders by dragging a row onto another', () => {
    const { seen } = setup(['a', 'b', 'c'])
    const rows = screen.getAllByRole('listitem')
    fireEvent.dragStart(rows[0])
    fireEvent.dragOver(rows[2])
    fireEvent.drop(rows[2])
    expect(seen.at(-1)).toEqual(['b', 'c', 'a'])
  })
  it('validates elements as they are typed', async () => {
    setup([1], { name: 'list', args: [{ name: 'int' }] })
    await userEvent.type(screen.getByRole('textbox', { name: 'Item 0' }), 'x')
    expect(screen.getByRole('textbox', { name: 'Item 0' })).toHaveAttribute('aria-invalid', 'true')
  })
  it('has a fixed length for a vector', () => {
    setup([1, 2], { name: 'vector', args: [{ name: 'float' }], size: 2 })
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove item/ })).not.toBeInTheDocument()
  })
  it('opens a nested editor for a collection element', async () => {
    const { onDrill } = setup([[1]], { name: 'list', args: [{ name: 'list', args: [{ name: 'int' }], frozen: true }] }, vi.fn())
    await userEvent.click(screen.getByRole('button', { name: 'Item 0' }))
    expect(onDrill).toHaveBeenCalledWith({ steps: [0], label: '[0]' })
  })
  it('says when the list is empty', () => {
    setup([])
    expect(screen.getByText('The list is empty.')).toBeInTheDocument()
  })
})
