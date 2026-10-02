import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DdlView } from './DdlView'
import { DDL } from '../test/schemaFixture'

describe('DdlView', () => {
  it('renders DDL text and actions', () => {
    render(<DdlView ddl={DDL} />)
    expect(screen.getByLabelText('DDL')).toHaveTextContent('CREATE TABLE payments.transactions_by_merchant')
    expect(screen.getByRole('button', { name: /Copy DDL/ })).toBeInTheDocument()
  })
  it('enables "Open in query tab" only with a handler', async () => {
    const { rerender } = render(<DdlView ddl={DDL} />)
    expect(screen.getByRole('button', { name: /Open in query tab/ })).toBeDisabled()
    const onOpen = vi.fn()
    rerender(<DdlView ddl={DDL} onOpenInQuery={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: /Open in query tab/ }))
    expect(onOpen).toHaveBeenCalled()
  })
})
