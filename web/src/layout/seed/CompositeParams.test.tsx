import { render, screen } from '@testing-library/react'
import { CompositeParams } from './CompositeParams'

describe('CompositeParams', () => {
  it('shows one generator per tuple field', () => {
    render(<CompositeParams spec={{ gen: 'composite' }} type={{ name: 'tuple', args: [{ name: 'int' }, { name: 'text' }] }} errors={{}} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Field 1 generator/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Field 2 generator/ })).toBeInTheDocument()
  })
  it('uses the UDT fields from the schema', () => {
    render(
      <CompositeParams
        spec={{ gen: 'composite' }}
        type={{ name: 'frozen<address>', udt: { keyspace: 'k', name: 'address' } }}
        udtFields={[{ name: 'street', desc: { name: 'text' } }]}
        errors={{}}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /street generator/ })).toBeInTheDocument()
  })
  it('says so when no fields are known', () => {
    render(<CompositeParams spec={{ gen: 'composite' }} type={{ name: 'x', udt: { keyspace: 'k', name: 'x' } }} errors={{}} onChange={() => {}} />)
    expect(screen.getByText(/default generators/)).toBeInTheDocument()
  })
})
