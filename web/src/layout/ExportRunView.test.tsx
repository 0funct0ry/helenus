import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportRunView } from './ExportRunView'
import type { JobInfo } from '../api/types'

const job = (over: Partial<JobInfo>): JobInfo => ({
  id: 'j', kind: 'export', profile: 'local', state: 'running', started_at: '', progress: { done: 1200, total: 0, errors: 0, rate_per_s: 600, eta_s: 0 }, ...over,
})

describe('ExportRunView', () => {
  it('shows progress and cancels', async () => {
    const onCancel = vi.fn()
    render(<ExportRunView job={job({})} filename="users.csv" onCancel={onCancel} onClose={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('1,200 rows')
    expect(screen.getByRole('status')).toHaveTextContent('600 rows/s')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel export' }))
    expect(onCancel).toHaveBeenCalled()
  })
  it('reports the finished file', () => {
    render(<ExportRunView job={job({ state: 'done', result: { filename: 'users.csv', rows: 5, bytes: 1, format: 'csv' } })} filename="x" onCancel={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Downloaded users.csv (5 rows)')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
  it('shows the failure message', () => {
    render(<ExportRunView job={job({ state: 'failed', result: { error: 'Excel allows 1,048,576 rows; use CSV for more' } })} filename="x" onCancel={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Excel allows 1,048,576 rows; use CSV for more')
  })
  it('reports a cancelled export', () => {
    render(<ExportRunView job={job({ state: 'cancelled' })} filename="x" onCancel={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/partial file was deleted/)).toBeInTheDocument()
  })
})
