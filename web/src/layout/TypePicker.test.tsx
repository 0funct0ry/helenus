import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypePicker } from './TypePicker'
import { draftToCql, newDraft } from '../lib/typeBuilder'
import type { TypeDraft } from '../lib/typeBuilder'

function Harness({ onValue }: { onValue: (cql: string) => void }) {
  const [v, setV] = useState<TypeDraft>(newDraft('text'))
  return (
    <>
      <TypePicker
        value={v}
        onChange={(x) => {
          setV(x)
          onValue(draftToCql(x))
        }}
        udts={['address']}
        label="Type of f"
      />
    </>
  )
}

const pick = async (name: string, option: string) => {
  await userEvent.click(screen.getByRole('button', { name }))
  await userEvent.click(screen.getByRole('option', { name: option }))
}

describe('TypePicker', () => {
  it('offers scalars, shapes and UDTs without a native select', async () => {
    const { container } = render(<Harness onValue={() => {}} />)
    expect(container.querySelector('select')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Type of f' }))
    for (const n of ['int', 'list<…>', 'map<…>', 'tuple<…>', 'vector<T, n>', 'address']) expect(screen.getByRole('option', { name: n })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'counter' })).not.toBeInTheDocument()
  })
  it('opens nested pickers for a map and builds nested types', async () => {
    const seen = vi.fn()
    render(<Harness onValue={seen} />)
    await pick('Type of f', 'map<…>')
    expect(seen).toHaveBeenLastCalledWith('map<text, text>')
    await pick('Type of f value', 'list<…>')
    await pick('Type of f value element', 'address')
    expect(seen).toHaveBeenLastCalledWith('map<text, list<address>>')
  })
  it('freezes a collection with the switch', async () => {
    const seen = vi.fn()
    render(<Harness onValue={seen} />)
    await pick('Type of f', 'set<…>')
    await userEvent.click(screen.getByRole('switch', { name: 'Type of f frozen' }))
    expect(seen).toHaveBeenLastCalledWith('frozen<set<text>>')
  })
  it('grows and shrinks a tuple', async () => {
    const seen = vi.fn()
    render(<Harness onValue={seen} />)
    await pick('Type of f', 'tuple<…>')
    await userEvent.click(screen.getByRole('button', { name: 'Add element' }))
    expect(seen).toHaveBeenLastCalledWith('tuple<text, text, text>')
    await userEvent.click(screen.getByRole('button', { name: 'Remove element 3 of Type of f' }))
    expect(seen).toHaveBeenLastCalledWith('tuple<text, text>')
  })
  it('takes a vector dimension', async () => {
    const seen = vi.fn()
    render(<Harness onValue={seen} />)
    await pick('Type of f', 'vector<T, n>')
    const dim = screen.getByRole('spinbutton', { name: 'Type of f dimension' })
    await userEvent.clear(dim)
    await userEvent.type(dim, '8')
    expect(seen).toHaveBeenLastCalledWith('vector<text, 8>')
  })
})
