import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MapEditor } from './MapEditor'
import { Stateful, renderEditor } from '../test/editors'
import type { TypeDesc } from '../api/types'

const textInt: TypeDesc = { name: 'map', args: [{ name: 'text' }, { name: 'int' }] }

function setup(initial: [unknown, unknown][], type = textInt, onDrill = vi.fn()) {
  const seen: [unknown, unknown][][] = []
  const view = renderEditor(
    <Stateful<[unknown, unknown][]> initial={initial} onValue={(v) => seen.push(v)}>
      {(v, set) => <MapEditor type={type} value={v} onChange={set} onDrill={onDrill} />}
    </Stateful>,
  )
  return { seen, onDrill, view }
}

describe('MapEditor', () => {
  it('shows key and value inputs with their types', () => {
    setup([['a', 1]])
    expect(screen.getByRole('textbox', { name: 'Key 0' })).toHaveValue('a')
    expect(screen.getByRole('textbox', { name: 'Value 0' })).toHaveValue('1')
    expect(screen.getByText('int')).toBeInTheDocument()
  })
  it('edits values with the value type’s validation', async () => {
    const { seen } = setup([['a', 1]])
    const v = screen.getByRole('textbox', { name: 'Value 0' })
    await userEvent.clear(v)
    await userEvent.type(v, '42')
    expect(seen.at(-1)).toEqual([['a', 42]])
    await userEvent.type(v, 'z')
    expect(v).toHaveAttribute('aria-invalid', 'true')
  })
  it('adds and removes entries', async () => {
    const { seen } = setup([['a', 1]])
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(seen.at(-1)).toEqual([['a', 1], ['', null]])
    await userEvent.click(screen.getByRole('button', { name: 'Remove entry 0' }))
    expect(seen.at(-1)).toEqual([['', null]])
  })
  it('flags duplicate keys and reports them as an error', async () => {
    const { view } = setup([['channel', 1], ['channel', 2]])
    expect(screen.getByRole('alert')).toHaveTextContent('The key channel already exists in this map.')
    expect(screen.getByRole('textbox', { name: 'Key 1' })).toHaveAttribute('aria-invalid', 'true')
    expect(view.errors()).toHaveLength(1)
  })
  it('clears the duplicate error once the keys differ', async () => {
    const { view } = setup([['a', 1], ['a', 2]])
    const k = screen.getByRole('textbox', { name: 'Key 1' })
    await userEvent.type(k, 'b')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(view.errors()).toEqual([])
  })
  it('drills into a collection value', async () => {
    const nested: TypeDesc = { name: 'map', args: [{ name: 'text' }, { name: 'list', frozen: true, args: [{ name: 'int' }] }] }
    const { onDrill } = setup([['a', [1]]], nested, vi.fn())
    await userEvent.click(screen.getByRole('button', { name: 'Value 0' }))
    expect(onDrill).toHaveBeenCalledWith({ steps: [0, 1], label: 'a' })
  })
  it('says when the map is empty', () => {
    setup([])
    expect(screen.getByText('The map is empty.')).toBeInTheDocument()
  })
})
