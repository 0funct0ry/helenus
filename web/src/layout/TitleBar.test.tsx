import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TitleBar } from './TitleBar'
import { useWorkspace } from '../store/workspace'

describe('TitleBar', () => {
  it('shows mark, profile, breadcrumb and theme toggle', () => {
    render(<TitleBar />)
    expect(screen.getByText('helenus')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /prod-eu/ })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('payments')
    expect(screen.getByRole('button', { name: /Theme:/ })).toBeInTheDocument()
  })
  it('opens the command palette', async () => {
    render(<TitleBar />)
    await userEvent.click(screen.getByRole('button', { name: /Search or run a command/ }))
    expect(useWorkspace.getState().paletteOpen).toBe(true)
  })
})
