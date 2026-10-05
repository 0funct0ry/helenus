import { fireEvent, render, screen } from '@testing-library/react'
import { RegexParams } from './RegexParams'

describe('RegexParams', () => {
  it('edits the pattern and shows the server regex error under it', () => {
    const onChange = vi.fn()
    render(
      <RegexParams spec={{ gen: 'regex', params: { pattern: '(' } }} type={{ name: 'text' }} errors={{ 'params.pattern': 'error parsing regexp: missing closing ): `(`' }} onChange={onChange} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('missing closing )')
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '[A-Z]{3}' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'regex', params: { pattern: '[A-Z]{3}' } })
  })
})
