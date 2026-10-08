import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createSavedQuery, deleteSavedQuery, duplicateSavedQuery, findSavedQuery, getSavedQuery, updateSavedQuery, useQueries, useQueryMutations } from './useQueries'
import { mockApi } from '../test/api'
import { savedRow } from '../test/queriesFixture'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)

describe('useQueries', () => {
  it('lists the profile queries and passes the filter', async () => {
    const calls = mockApi({ 'GET /p/local/queries': { queries: [savedRow()] }, 'GET /p/local/queries?q=a%20b': { queries: [] } })
    const { result } = renderHook(() => useQueries('local'), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    renderHook(() => useQueries('local', 'a b'), { wrapper })
    await waitFor(() => expect(calls.some((c) => c.path === '/p/local/queries?q=a%20b')).toBe(true))
  })
  it('does not fetch without a profile', () => {
    const calls = mockApi({})
    renderHook(() => useQueries(''), { wrapper })
    expect(calls).toHaveLength(0)
  })
})

describe('query requests', () => {
  it('maps each operation to its route', async () => {
    const calls = mockApi({
      'GET /p/local/queries/1': savedRow({ text: 'x' }),
      'POST /p/local/queries': { status: 201, body: savedRow() },
      'PUT /p/local/queries/1': savedRow({ version: 2 }),
      'DELETE /p/local/queries/1': { status: 204 },
      'POST /p/local/queries/1/duplicate': { status: 201, body: savedRow({ id: 2 }) },
      'GET /p/local/queries?q=Reports%2FDaily': { queries: [savedRow(), savedRow({ id: 2, global: true })] },
    })
    expect((await getSavedQuery('local', 1)).text).toBe('x')
    await createSavedQuery('local', { name: 'a', text: 't', global: false })
    await updateSavedQuery('local', 1, { name: 'a', text: 't', global: true, version: 1 })
    await deleteSavedQuery('local', 1)
    expect((await duplicateSavedQuery('local', 1)).id).toBe(2)
    expect((await findSavedQuery('local', 'Reports/Daily', true))?.id).toBe(2)
    expect(calls.find((c) => c.method === 'POST' && c.path === '/p/local/queries')?.body).toEqual({ name: 'a', text: 't', global: false })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'a', text: 't', global: true, version: 1 })
  })
})

describe('useQueryMutations', () => {
  it('refreshes the list after a change', async () => {
    const calls = mockApi({ 'GET /p/local/queries': { queries: [] }, 'DELETE /p/local/queries/1': { status: 204 } })
    const { result } = renderHook(() => ({ list: useQueries('local'), m: useQueryMutations('local') }), { wrapper })
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    await result.current.m.remove.mutateAsync(1)
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2))
  })
})
