import { fireEvent, render, screen } from '@testing-library/react'
import { BooleanParams } from './BooleanParams'

describe('BooleanParams', () => {
  it('edits the probability', () => {
    const onChange = vi.fn()
    render(<BooleanParams spec={{ gen: 'boolean' }} type={{ name: 'boolean' }} errors={{ 'params.p_true': 'between 0 and 1' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Probability of true (0–1)'), { target: { value: '0.9' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'boolean', params: { p_true: 0.9 } })
    expect(screen.getByRole('alert')).toHaveTextContent('between 0 and 1')
  })
})
