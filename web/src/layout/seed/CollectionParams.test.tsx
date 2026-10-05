import { fireEvent, render, screen } from '@testing-library/react'
import { CollectionParams } from './CollectionParams'

describe('CollectionParams', () => {
  it('edits the size range and shows an element generator', () => {
    const onChange = vi.fn()
    render(<CollectionParams spec={{ gen: 'collection' }} type={{ name: 'list', args: [{ name: 'int' }] }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Max size'), { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'collection', params: { max: 5 } })
    expect(screen.getByRole('button', { name: /Element generator/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Key generator/ })).not.toBeInTheDocument()
  })
  it('adds a key generator for maps', () => {
    render(<CollectionParams spec={{ gen: 'collection' }} type={{ name: 'map', args: [{ name: 'text' }, { name: 'int' }] }} errors={{}} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Key generator/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Value generator/ })).toBeInTheDocument()
  })
})
