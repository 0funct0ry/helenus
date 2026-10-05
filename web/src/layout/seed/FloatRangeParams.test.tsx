import { fireEvent, render, screen } from '@testing-library/react'
import { FloatRangeParams } from './FloatRangeParams'

describe('FloatRangeParams', () => {
  it('edits min, max and decimals', () => {
    const onChange = vi.fn()
    render(<FloatRangeParams spec={{ gen: 'float_range' }} type={{ name: 'double' }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Decimals'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'float_range', params: { decimals: 3 } })
    fireEvent.change(screen.getByLabelText('Min'), { target: { value: '-1.5' } })
    expect(onChange).toHaveBeenLastCalledWith({ gen: 'float_range', params: { min: -1.5 } })
  })
})
