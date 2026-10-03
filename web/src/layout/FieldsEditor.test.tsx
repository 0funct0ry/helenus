import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldsEditor } from './FieldsEditor'
import { Stateful, renderEditor } from '../test/editors'
import type { TypeDesc } from '../api/types'

const fields = [
  { name: 'city', type: { name: 'text' } as TypeDesc },
  { name: 'zip', type: { name: 'bigint' } as TypeDesc },
  { name: 'tags', type: { name: 'set', frozen: true, args: [{ name: 'text' }] } as TypeDesc },
]

describe('FieldsEditor', () => {
  it('edits UDT fields by name', async () => {
    const seen: unknown[] = []
    renderEditor(
      <Stateful<Record<string, unknown> | unknown[] | null> initial={{ city: 'Pune', zip: null }} onValue={(v) => seen.push(v)}>
        {(v, set) => <FieldsEditor fields={fields} value={v} onChange={set} onDrill={() => {}} />}
      </Stateful>,
    )
    expect(screen.getByRole('textbox', { name: 'Field city' })).toHaveValue('Pune')
    await userEvent.type(screen.getByRole('textbox', { name: 'Field zip' }), '411001')
    expect(seen.at(-1)).toEqual({ city: 'Pune', zip: '411001' })
  })
  it('sets a field to null when its input is emptied', async () => {
    const seen: unknown[] = []
    renderEditor(
      <Stateful<Record<string, unknown> | unknown[] | null> initial={{ city: 'Pune' }} onValue={(v) => seen.push(v)}>
        {(v, set) => <FieldsEditor fields={fields.slice(0, 2)} value={v} onChange={set} onDrill={() => {}} />}
      </Stateful>,
    )
    await userEvent.clear(screen.getByRole('textbox', { name: 'Field city' }))
    expect(seen.at(-1)).toEqual({ city: null })
  })
  it('drills into a collection field', async () => {
    const onDrill = vi.fn()
    renderEditor(<FieldsEditor fields={fields} value={{ tags: ['a'] }} onChange={() => {}} onDrill={onDrill} />)
    await userEvent.click(screen.getByRole('button', { name: 'Field tags' }))
    expect(onDrill).toHaveBeenCalledWith({ steps: ['tags'], label: 'tags' })
  })
  it('edits tuple elements by position', async () => {
    const seen: unknown[] = []
    const tuple = [{ name: '0', type: { name: 'double' } as TypeDesc }, { name: '1', type: { name: 'text' } as TypeDesc }]
    renderEditor(
      <Stateful<Record<string, unknown> | unknown[] | null> initial={[1.5, 'a']} onValue={(v) => seen.push(v)}>
        {(v, set) => <FieldsEditor tuple fields={tuple} value={v} onChange={set} onDrill={() => {}} />}
      </Stateful>,
    )
    const second = screen.getByRole('textbox', { name: 'Element 1' })
    await userEvent.clear(second)
    await userEvent.type(second, 'b')
    expect(seen.at(-1)).toEqual([1.5, 'b'])
  })
})
