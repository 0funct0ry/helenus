import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InsertRowDialog } from './InsertRowDialog'
import type { QueryColumn } from '../api/types'

const columns: QueryColumn[] = [
  { name: 'id', type: { name: 'uuid' }, kind: 'partition', position: 1 },
  { name: 'amount', type: { name: 'decimal' }, kind: 'regular' },
  { name: 'tags', type: { name: 'set', args: [{ name: 'text' }] }, kind: 'regular' },
]
const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

function setup(props: Partial<React.ComponentProps<typeof InsertRowDialog>> = {}) {
  const onStage = vi.fn()
  const onClose = vi.fn()
  render(<InsertRowDialog open onClose={onClose} columns={columns} onStage={onStage} {...props} />)
  return { onStage, onClose }
}

describe('InsertRowDialog', () => {
  it('needs the primary key before the insert can be staged', async () => {
    setup()
    expect(screen.getByRole('button', { name: 'Stage insert' })).toBeDisabled()
    expect(screen.getByText('Fill in id')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'id' }), ID)
    expect(screen.getByRole('button', { name: 'Stage insert' })).toBeEnabled()
  })

  it('stages the entered values and leaves empty optional columns out', async () => {
    const { onStage, onClose } = setup()
    await userEvent.type(screen.getByRole('textbox', { name: 'id' }), ID)
    await userEvent.type(screen.getByRole('textbox', { name: 'amount' }), '12.50')
    await userEvent.click(screen.getByRole('button', { name: 'Stage insert' }))
    expect(onStage).toHaveBeenCalledWith({ id: ID, amount: '12.50' }, false)
    expect(onClose).toHaveBeenCalled()
  })

  it('passes the IF NOT EXISTS choice', async () => {
    const { onStage } = setup()
    await userEvent.type(screen.getByRole('textbox', { name: 'id' }), ID)
    await userEvent.click(screen.getByRole('switch', { name: 'IF NOT EXISTS' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stage insert' }))
    expect(onStage).toHaveBeenCalledWith({ id: ID }, true)
  })

  it('blocks staging while a value is invalid', async () => {
    setup()
    await userEvent.type(screen.getByRole('textbox', { name: 'id' }), ID)
    await userEvent.type(screen.getByRole('textbox', { name: 'amount' }), 'abc')
    expect(screen.getByRole('button', { name: 'Stage insert' })).toBeDisabled()
  })

  it('edits a collection column in the popover and stages its value', async () => {
    const { onStage } = setup()
    await userEvent.type(screen.getByRole('textbox', { name: 'id' }), ID)
    await userEvent.click(screen.getByRole('button', { name: 'tags' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), 'vip')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('button', { name: 'Set value' }))
    expect(screen.getByRole('button', { name: 'tags' })).toHaveTextContent("{'vip'}")
    await userEvent.click(screen.getByRole('button', { name: 'Stage insert' }))
    expect(onStage).toHaveBeenCalledWith({ id: ID, tags: ['vip'] }, false)
  })

  it('starts from the duplicated row, without truncated blobs, and lets the key change', async () => {
    const { onStage } = setup({
      duplicate: true,
      initial: { id: ID, amount: '9.99', raw: { $truncated: true, preview: '0x00', bytes: 99999 } },
    })
    expect(screen.getByRole('dialog', { name: 'Duplicate row' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'amount' })).toHaveValue('9.99')
    const id = screen.getByRole('textbox', { name: 'id' })
    await userEvent.clear(id)
    await userEvent.type(id, '3f1a2b10-9d3c-11ef-8a6e-0242ac120002')
    await userEvent.click(screen.getByRole('button', { name: 'Stage insert' }))
    expect(onStage).toHaveBeenCalledWith({ id: '3f1a2b10-9d3c-11ef-8a6e-0242ac120002', amount: '9.99' }, false)
  })

  it('cancels without staging', async () => {
    const { onStage, onClose } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onStage).not.toHaveBeenCalled()
  })
})
