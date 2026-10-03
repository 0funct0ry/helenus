import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionPopover } from './CollectionPopover'
import type { TypeDesc } from '../api/types'
import type { UdtFields } from '../lib/valueModel'

const udtFields: UdtFields = (r) =>
  r.name === 'contact' ? [{ name: 'city', type: { name: 'text' } }, { name: 'tags', type: { name: 'set', frozen: true, args: [{ name: 'text' }] } }] : undefined

function Harness({ type, original, draft, onStage, onClose = () => {} }: { type: TypeDesc; original: unknown; draft?: unknown; onStage: (v: unknown) => void; onClose?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={ref}>cell</button>
      <CollectionPopover open onClose={onClose} anchorRef={ref} name="tags" type={type} original={original} draft={draft} udtFields={udtFields} onStage={onStage} />
    </>
  )
}
const set: TypeDesc = { name: 'set', args: [{ name: 'text' }] }
const map: TypeDesc = { name: 'map', args: [{ name: 'text' }, { name: 'text' }] }

describe('CollectionPopover', () => {
  it('names the column and its type and starts with Stage change disabled', () => {
    render(<Harness type={set} original={['a']} onStage={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Edit tags' })).toBeInTheDocument()
    expect(screen.getByText('set<text>')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stage change' })).toBeDisabled()
  })

  it('stages the edited value and closes', async () => {
    const onStage = vi.fn()
    const onClose = vi.fn()
    render(<Harness type={set} original={['a']} onStage={onStage} onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), 'vip')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stage change' }))
    expect(onStage).toHaveBeenCalledWith(['a', 'vip'])
    expect(onClose).toHaveBeenCalled()
  })

  it('does not stage when cancelled', async () => {
    const onStage = vi.fn()
    const onClose = vi.fn()
    render(<Harness type={set} original={['a']} onStage={onStage} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onStage).not.toHaveBeenCalled()
  })

  it('blocks staging while a map has a duplicate key', async () => {
    render(<Harness type={map} original={[['a', '1']]} onStage={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Key 1' }), 'a')
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('already exists')
    expect(screen.getByRole('button', { name: 'Stage change' })).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Key 1' }), 'b')
    expect(screen.getByRole('button', { name: 'Stage change' })).toBeEnabled()
  })

  it('blocks staging while an input is invalid', async () => {
    render(<Harness type={{ name: 'list', args: [{ name: 'int' }] }} original={[1]} onStage={() => {}} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Item 0' }), 'x')
    expect(screen.getByRole('button', { name: 'Stage change' })).toBeDisabled()
  })

  it('starts from an already staged draft instead of the original', () => {
    render(<Harness type={set} original={['a']} draft={['a', 'staged']} onStage={() => {}} />)
    expect(screen.getByText('staged')).toBeInTheDocument()
  })

  it('drills into a nested value with a breadcrumb and goes back up', async () => {
    const onStage = vi.fn()
    const nested: TypeDesc = { name: 'list', args: [{ name: 'contact', frozen: true, udt: { keyspace: 'k', name: 'contact' } }] }
    render(<Harness type={nested} original={[{ city: 'Pune', tags: ['a'] }]} onStage={onStage} />)
    await userEvent.click(screen.getByRole('button', { name: 'Item 0' }))
    expect(screen.getByRole('textbox', { name: 'Field city' })).toHaveValue('Pune')
    expect(screen.getByRole('navigation', { name: 'Nested value' })).toHaveTextContent('[0]')
    // a second level
    await userEvent.type(screen.getByRole('textbox', { name: 'Field city' }), 'e')
    await userEvent.click(screen.getByRole('button', { name: 'Field tags' }))
    expect(screen.getByRole('textbox', { name: 'New member' })).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'New member' }), 'b')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('button', { name: 'tags' }))
    expect(screen.getByRole('button', { name: 'Item 0' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stage change' }))
    expect(onStage).toHaveBeenCalledWith([{ city: 'Punee', tags: ['a', 'b'] }])
  })
})
