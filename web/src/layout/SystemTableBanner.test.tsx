import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SystemTableBanner } from './SystemTableBanner'
import { mockApi, renderWithClient } from '../test/api'

const docs = { keyspaces: { system: { description: 'x', tables: { local: { description: 'This node.' } } } } }

describe('SystemTableBanner', () => {
  it('shows the catalog description', async () => {
    mockApi({ 'GET /system-docs': docs })
    renderWithClient(<SystemTableBanner keyspace="system" table="local" />)
    await waitFor(() => expect(screen.getByText('This node.')).toBeInTheDocument())
    expect(screen.getByText(/What is this table/)).toBeInTheDocument()
  })
  it('falls back for unknown tables', async () => {
    mockApi({ 'GET /system-docs': docs })
    renderWithClient(<SystemTableBanner keyspace="system" table="mystery" />)
    await waitFor(() => expect(screen.getByText('No description available')).toBeInTheDocument())
  })
})
