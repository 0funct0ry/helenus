import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportUploadStep } from './ImportUploadStep'

const base = { uploaded: null, uploading: false, progress: 0, error: null, onFile: () => {} }

describe('ImportUploadStep', () => {
  it('passes a chosen file on', async () => {
    const onFile = vi.fn()
    render(<ImportUploadStep {...base} onFile={onFile} />)
    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText('Import file'), file)
    expect(onFile).toHaveBeenCalledWith(file)
  })
  it('accepts a dropped file', () => {
    const onFile = vi.fn()
    render(<ImportUploadStep {...base} onFile={onFile} />)
    const file = new File(['a'], 'x.json')
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)
  })
  it('shows progress while uploading and ignores drops', () => {
    const onFile = vi.fn()
    render(<ImportUploadStep {...base} uploading progress={0.4} onFile={onFile} />)
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute('aria-valuenow', '40')
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [new File(['a'], 'x.csv')] } })
    expect(onFile).not.toHaveBeenCalled()
  })
  it('shows the uploaded file and errors', () => {
    const { rerender } = render(<ImportUploadStep {...base} uploaded={{ name: 'users.csv', size: 2048 }} />)
    expect(screen.getByText('users.csv')).toBeInTheDocument()
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument()
    rerender(<ImportUploadStep {...base} error="larger than the upload limit" />)
    expect(screen.getByRole('alert')).toHaveTextContent('upload limit')
  })
})
