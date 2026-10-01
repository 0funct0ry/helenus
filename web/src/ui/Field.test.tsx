import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Field } from './Field'

describe('Field', () => {
  it('associates the label with the input', async () => {
    render(<Field label="Port" defaultValue="9042" />)
    const input = screen.getByLabelText('Port')
    await userEvent.type(input, '1')
    expect(input).toHaveValue('90421')
  })
})
