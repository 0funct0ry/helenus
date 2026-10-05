import { fireEvent, render, screen } from '@testing-library/react'
import { ParamField } from './ParamField'

describe('ParamField', () => {
  it('labels the input, reports changes and shows the error', () => {
    const onChange = vi.fn()
    render(<ParamField label="Min" value="1" error="must be a number" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Min'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith('12')
    expect(screen.getByRole('alert')).toHaveTextContent('must be a number')
    expect(screen.getByLabelText('Min')).toHaveAttribute('aria-invalid', 'true')
  })
})
