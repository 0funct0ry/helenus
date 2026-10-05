import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPresetBar } from './ExportPresetBar'
import { mockApi, renderWithClient as render } from '../test/api'
import { DEFAULT_EXPORT_OPTIONS } from '../lib/exportModel'
import type { ExportPreset } from '../api/types'

const preset: ExportPreset = { id: 7, profile: 'local', name: 'Finance CSV', format: 'csv', options: { delimiter: ';' }, columns: ['a'], created_at: '', updated_at: '' }
const list = 'GET /p/local/export/presets'

function setup(extra: Record<string, unknown> = {}) {
  const calls = mockApi({ [list]: { presets: [preset] }, ...extra })
  const onLoad = vi.fn()
  render(<ExportPresetBar profile="local" format="json" options={DEFAULT_EXPORT_OPTIONS} columns={null} onLoad={onLoad} />)
  return { calls, onLoad }
}

async function choose() {
  await waitFor(() => expect(screen.getByRole('button', { name: /Load preset/ })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: /Load preset/ }))
  await userEvent.click(await screen.findByRole('option', { name: 'Finance CSV' }))
}

describe('ExportPresetBar', () => {
  it('loads a preset', async () => {
    const { onLoad } = setup()
    await choose()
    expect(onLoad).toHaveBeenCalledWith(preset)
  })
  it('updates the loaded preset with the current choices', async () => {
    const { calls } = setup({ 'PUT /p/local/export/presets/7': { body: preset } })
    expect(screen.getByRole('button', { name: 'Update preset' })).toBeDisabled()
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Update preset' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ name: 'Finance CSV', format: 'json', columns: null })
  })
  it('deletes after confirmation', async () => {
    const { calls } = setup({ 'DELETE /p/local/export/presets/7': { status: 204 } })
    await choose()
    await userEvent.click(screen.getByRole('button', { name: 'Delete preset' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  })
  it('opens the save dialog', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Save as preset…' }))
    expect(screen.getByLabelText('Preset name')).toBeInTheDocument()
  })
})
