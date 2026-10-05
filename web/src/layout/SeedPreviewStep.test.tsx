import { render, screen } from '@testing-library/react'
import { SeedPreviewStep } from './SeedPreviewStep'
import { seedColumns, seedRows } from '../test/seedFixture'

describe('SeedPreviewStep', () => {
  it('shows the statement, notes and the generated rows', () => {
    render(<SeedPreviewStep columns={seedColumns} rows={seedRows.slice(0, 2)} statement="INSERT INTO k.t (id) VALUES (1);" notes={['Column x was reset']} pending={false} />)
    expect(screen.getByText('INSERT INTO k.t (id) VALUES (1);')).toBeInTheDocument()
    expect(screen.getByText('Column x was reset')).toBeInTheDocument()
    expect(screen.getByText('ada.lovelace1@example.com')).toBeInTheDocument()
  })
})
