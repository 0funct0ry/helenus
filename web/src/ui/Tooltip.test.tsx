import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  it('shows on hover and hides on leave', async () => {
    render(<Tooltip content="Hello tip"><button>x</button></Tooltip>)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await userEvent.hover(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hello tip')
    await userEvent.unhover(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
  it('shows on keyboard focus', async () => {
    render(<Tooltip content="Focus tip"><button>x</button></Tooltip>)
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
})
