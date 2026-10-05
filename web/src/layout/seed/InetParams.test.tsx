import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InetParams } from './InetParams'

describe('InetParams', () => {
  it('switches between IPv4 and IPv6', async () => {
    const onChange = vi.fn()
    render(<InetParams spec={{ gen: 'inet' }} type={{ name: 'inet' }} errors={{}} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Version/ }))
    await userEvent.click(screen.getByRole('option', { name: 'IPv6' }))
    expect(onChange).toHaveBeenCalledWith({ gen: 'inet', params: { version: 'v6' } })
  })
})
