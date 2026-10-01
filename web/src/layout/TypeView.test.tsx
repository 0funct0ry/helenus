import { render, screen } from '@testing-library/react'
import { TypeView } from './TypeView'
import { initialTabs } from '../store/workspace'

describe('TypeView', () => {
  it('lists fields and usages and blocks drop when in use', () => {
    render(<TypeView tab={initialTabs[2]} />)
    expect(screen.getByText('postal_code')).toBeInTheDocument()
    expect(screen.getByText('customers.home_address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Drop type/ })).toBeDisabled()
  })
  it('handles unknown types', () => {
    render(<TypeView tab={{ ...initialTabs[2], object: 'nope' }} />)
    expect(screen.getByText('Type not found.')).toBeInTheDocument()
  })
})
