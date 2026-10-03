import { render, screen } from '@testing-library/react'
import { ValueEditor } from './ValueEditor'
import type { TypeDesc } from '../api/types'
import type { UdtFields } from '../lib/valueModel'

const udtFields: UdtFields = () => [{ name: 'city', type: { name: 'text' } }]
const show = (type: TypeDesc, value: unknown) => render(<ValueEditor type={type} value={value} onChange={() => {}} onDrill={() => {}} udtFields={udtFields} />)

describe('ValueEditor', () => {
  it('uses the list editor for lists', () => {
    show({ name: 'list', args: [{ name: 'text' }] }, ['a'])
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
  })
  it('uses the set editor for sets', () => {
    show({ name: 'set', args: [{ name: 'text' }] }, ['a'])
    expect(screen.getByRole('textbox', { name: 'New member' })).toBeInTheDocument()
  })
  it('uses the map editor for maps', () => {
    show({ name: 'map', args: [{ name: 'text' }, { name: 'int' }] }, [['a', 1]])
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeInTheDocument()
  })
  it('uses the fields editor for UDTs and tuples', () => {
    const { unmount } = show({ name: 'address', udt: { keyspace: 'k', name: 'address' } }, { city: 'Pune' })
    expect(screen.getByRole('textbox', { name: 'Field city' })).toHaveValue('Pune')
    unmount()
    show({ name: 'tuple', args: [{ name: 'int' }] }, [3])
    expect(screen.getByRole('textbox', { name: 'Element 0' })).toHaveValue('3')
  })
  it('treats a missing value as empty', () => {
    show({ name: 'list', args: [{ name: 'text' }] }, null)
    expect(screen.getByText('The list is empty.')).toBeInTheDocument()
  })
  it('explains a type it has no editor for', () => {
    show({ name: 'int' }, 1)
    expect(screen.getByText('int has no collection editor.')).toBeInTheDocument()
  })
})
