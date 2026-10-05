import { fireEvent, render, screen } from '@testing-library/react'
import { IntRangeParams } from './IntRangeParams'

describe('IntRangeParams', () => {
  it('edits min and max as numbers', () => {
    const onChange = vi.fn()
    render(<IntRangeParams spec={{ gen: 'int_range', params: { min: 1 } }} type={{ name: 'int' }} errors={{ 'params.max': 'too big' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Max'), { target: { value: '99' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'int_range', params: { min: 1, max: 99 } })
    expect(screen.getByRole('alert')).toHaveTextContent('too big')
  })
})
