import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetEditor } from './SetEditor'
import { Stateful, renderEditor } from '../test/editors'
import type { TypeDesc } from '../api/types'

const text: TypeDesc = { name: 'set', args: [{ name: 'text' }] }
const ints: TypeDesc = { name: 'set', args: [{ name: 'int' }] }

function setup(initial: unknown[], type = text, onDrill = vi.fn()) {
  const seen: unknown[][] = []
  const view = renderEditor(
    <Stateful<unknown[]> initial={initial} onValue={(v) => seen.push(v)}>
      {(v, set) => <SetEditor type={type} value={v} onChange={set} onDrill={onDrill} />}
    </Stateful>,
  )
  return { seen, onDrill, view }
}

describe('SetEditor', () => {
  it('lists members and removes one', async () => {
    const { seen } = setup(['a', 'b'])
    expect(screen.getByText('a')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove b' }))
    expect(seen.at(-1)).toEqual(['a'])
  })
  it('adds a member and keeps the set sorted', async () => {
    const { seen } = setup(['b', 'd'])
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), 'c')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(seen.at(-1)).toEqual(['b', 'c', 'd'])
    expect(screen.getByRole('textbox', { name: 'New member' })).toHaveValue('')
  })
  it('sorts numbers by value', async () => {
    const { seen } = setup([2, 10], ints)
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), '9')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(seen.at(-1)).toEqual([2, 9, 10])
  })
  it('prevents a duplicate and says why', async () => {
    const { seen } = setup(['a'])
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), 'a')
    expect(screen.getByText('That value is already in the set.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(seen).toEqual([])
  })
  it('validates the new member against the element type', async () => {
    setup([1], ints)
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), 'x')
    expect(screen.getByText('Enter a whole number')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
  it('does not let a half-typed new member block staging', async () => {
    const { view } = setup([1], ints)
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), 'x')
    expect(view.errors()).toEqual([])
  })
  it('flags duplicate members of a composite set and reports them', async () => {
    const udtSet: TypeDesc = { name: 'set', args: [{ name: 'list', frozen: true, args: [{ name: 'int' }] }] }
    const { view } = setup([[1], [1]], udtSet)
    expect(view.errors()).toEqual(['This set has a duplicate member.'])
    expect(screen.getByRole('button', { name: 'Member 0' })).toBeInTheDocument()
  })
  it('adds an empty member to a composite set', async () => {
    const udtSet: TypeDesc = { name: 'set', args: [{ name: 'list', frozen: true, args: [{ name: 'int' }] }] }
    const { seen } = setup([[1]], udtSet)
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
    expect(seen.at(-1)).toEqual([[1], []])
  })
})
