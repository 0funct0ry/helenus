import { fireEvent, render, screen } from '@testing-library/react'
import { DurationParams } from './DurationParams'

describe('DurationParams', () => {
  it('edits min and max seconds', () => {
    const onChange = vi.fn()
    render(<DurationParams spec={{ gen: 'duration_range' }} type={{ name: 'duration' }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Max seconds'), { target: { value: '3600' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'duration_range', params: { max_seconds: 3600 } })
  })
})
