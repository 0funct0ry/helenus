import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportSavePresetDialog } from './ExportSavePresetDialog'
import { mockApi, renderWithClient as render } from '../test/api'
import { DEFAULT_EXPORT_OPTIONS } from '../lib/exportModel'

function setup(handler: unknown) {
  const calls = mockApi({ 'POST /p/local/export/presets': handler })
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(<ExportSavePresetDialog profile="local" format="csv" options={DEFAULT_EXPORT_OPTIONS} columns={['a']} onSaved={onSaved} onClose={onClose} />)
  return { calls, onSaved, onClose }
}

describe('ExportSavePresetDialog', () => {
  it('saves the format, options and columns under the typed name', async () => {
    const { calls, onSaved, onClose } = setup({ status: 201, body: { id: 1 } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Preset name'), 'Finance CSV')
    await userEvent.click(screen.getByRole('switch', { name: 'Available for all profiles' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalledWith('Finance CSV')
    expect(calls[0].body).toMatchObject({ name: 'Finance CSV', format: 'csv', columns: ['a'], global: true })
  })
  it('shows a duplicate-name error and stays open', async () => {
    const { onClose } = setup({ status: 409, body: { error: { code: 'export_preset_exists', message: 'exists' } } })
    await userEvent.type(screen.getByLabelText('Preset name'), 'Finance CSV')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(onClose).not.toHaveBeenCalled()
  })
})
