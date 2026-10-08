import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useQueryActions } from './useQueryActions'
import { mockApi } from '../test/api'
import { blobText, boundTab, boundWorkspace, savedRow, toastMessages } from '../test/queriesFixture'
import { useQueryDialogs } from '../store/queryDialogs'
import { useWorkspace } from '../store/workspace'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
const setup = () => renderHook(() => useQueryActions(), { wrapper }).result.current
const dirty = () => useWorkspace.getState().patchQuery('query-1', { text: 'SELECT 2;' })

describe('save', () => {
  beforeEach(() => boundWorkspace())

  it('puts a bound tab with its saved version, clears the dirty state and toasts', async () => {
    const calls = mockApi({ 'PUT /p/local/queries/1': savedRow({ version: 2 }), 'GET /p/local/queries': { queries: [] } })
    dirty()
    expect(await setup().save('query-1')).toBe(true)
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'reports/daily', text: 'SELECT 2;', global: false, version: 1 })
    expect(useWorkspace.getState().queryStates['query-1']).toMatchObject({ savedText: 'SELECT 2;', savedVersion: 2 })
    expect(toastMessages()).toEqual(['Saved daily.cql'])
  })
  it('closes the tab after saving when asked', async () => {
    mockApi({ 'PUT /p/local/queries/1': savedRow({ version: 2 }) })
    await setup().save('query-1', true)
    expect(useWorkspace.getState().tabs).toHaveLength(0)
  })
  it('opens Save as for an unbound tab', async () => {
    boundWorkspace([{ ...boundTab, savedQueryId: undefined, queryName: undefined }])
    expect(await setup().save('query-1')).toBe(false)
    expect(useQueryDialogs.getState().saveAs).toEqual({ tabId: 'query-1', name: '', closeAfter: undefined })
  })
  it('ignores tabs that are not query tabs', async () => {
    boundWorkspace([{ ...boundTab, kind: 'table' }])
    expect(await setup().save('query-1')).toBe(false)
    expect(useQueryDialogs.getState().saveAs).toBeNull()
  })
  it('opens the conflict dialog with the current row on query_conflict', async () => {
    const current = savedRow({ version: 5, text: 'theirs' })
    mockApi({ 'PUT /p/local/queries/1': { status: 409, body: { error: { code: 'query_conflict', message: 'changed', detail: current } } } })
    dirty()
    expect(await setup().save('query-1')).toBe(false)
    expect(useQueryDialogs.getState().conflict).toEqual({ tabId: 'query-1', current, closeAfter: undefined })
    expect(useWorkspace.getState().queryStates['query-1'].savedVersion).toBe(1)
  })
  it('overwrite saves against the current version', async () => {
    const calls = mockApi({ 'PUT /p/local/queries/1': savedRow({ version: 6 }) })
    dirty()
    await setup().overwrite('query-1', savedRow({ version: 5 }))
    expect((calls[0].body as { version: number }).version).toBe(5)
    expect(useWorkspace.getState().queryStates['query-1'].savedVersion).toBe(6)
  })
  it('unbinds on 404, toasts and opens Save as', async () => {
    mockApi({ 'PUT /p/local/queries/1': { status: 404, body: { error: { code: 'query_not_found', message: 'gone' } } }, 'GET /p/local/queries': { queries: [] } })
    dirty()
    await setup().save('query-1')
    expect(useWorkspace.getState().tabs[0].savedQueryId).toBeUndefined()
    expect(useWorkspace.getState().queryStates['query-1'].text).toBe('SELECT 2;')
    expect(toastMessages()).toEqual(['daily.cql was deleted from the library; the tab is now unsaved'])
    expect(useQueryDialogs.getState().saveAs).toMatchObject({ tabId: 'query-1', name: 'reports/daily' })
  })
  it('toasts other errors and stays bound', async () => {
    mockApi({ 'PUT /p/local/queries/1': { status: 500, body: { error: { code: 'internal', message: 'boom' } } } })
    expect(await setup().save('query-1')).toBe(false)
    expect(toastMessages()).toEqual(['Could not save: boom'])
    expect(useWorkspace.getState().tabs[0].savedQueryId).toBe(1)
  })
})

describe('requestClose', () => {
  it('closes clean tabs at once', () => {
    boundWorkspace()
    setup().requestClose('query-1')
    expect(useWorkspace.getState().tabs).toHaveLength(0)
  })
  it('asks about dirty bound tabs', () => {
    boundWorkspace()
    dirty()
    setup().requestClose('query-1')
    expect(useWorkspace.getState().tabs).toHaveLength(1)
    expect(useQueryDialogs.getState().unsaved).toBe('query-1')
  })
  it('never asks for unbound tabs', () => {
    boundWorkspace([{ ...boundTab, savedQueryId: undefined }], { 'query-1': { text: 'edited', savedText: 'orig' } })
    setup().requestClose('query-1')
    expect(useWorkspace.getState().tabs).toHaveLength(0)
  })
})

describe('openQuery', () => {
  beforeEach(() => boundWorkspace())
  it('activates a tab already bound to the query', async () => {
    useWorkspace.getState().newQuery()
    const calls = mockApi({})
    await setup().openQuery({ id: 1 })
    expect(useWorkspace.getState().activeId).toBe('query-1')
    expect(calls).toHaveLength(0)
  })
  it('opens a new bound tab titled by the last segment', async () => {
    mockApi({ 'GET /p/local/queries/9': savedRow({ id: 9, name: 'a/b/weekly', global: true, version: 3, text: 'SELECT 9;' }) })
    await setup().openQuery({ id: 9 })
    const s = useWorkspace.getState()
    expect(s.tabs[1]).toMatchObject({ title: 'weekly.cql', savedQueryId: 9, queryName: 'a/b/weekly', queryGlobal: true })
    expect(s.queryStates[s.activeId]).toMatchObject({ text: 'SELECT 9;', savedText: 'SELECT 9;', savedVersion: 3 })
  })
  it('opens another tab when asked, even if one is bound', async () => {
    mockApi({ 'GET /p/local/queries/1': savedRow({ text: 'SELECT 1;' }) })
    await setup().openQuery({ id: 1 }, true)
    expect(useWorkspace.getState().tabs).toHaveLength(2)
  })
  it('toasts when the query cannot be loaded', async () => {
    mockApi({})
    await setup().openQuery({ id: 42 })
    expect(toastMessages()[0]).toMatch(/^Could not open the query/)
  })
})

describe('files', () => {
  beforeEach(() => boundWorkspace())
  it('downloads the tab text under its title', async () => {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:1'))
    URL.revokeObjectURL = vi.fn()
    let name = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    useWorkspace.getState().patchQuery('query-1', { text: 'a\r\nb\n' })
    setup().downloadTab('query-1')
    expect(name).toBe('daily.cql')
    expect(await blobText(blob)).toBe('a\r\nb\n')
    click.mockRestore()
  })
  it('downloads a library query as its last segment', async () => {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:2'))
    URL.revokeObjectURL = vi.fn()
    let name = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    mockApi({ 'GET /p/local/queries/1': savedRow({ text: 'SELECT 1;' }) })
    await setup().downloadQuery({ id: 1 })
    expect(name).toBe('daily.cql')
    expect(await blobText(blob)).toBe('SELECT 1;')
    click.mockRestore()
  })
  it('opens a file in a new unbound tab titled with its name', async () => {
    await setup().openFile(new File(['SELECT 5;\n'], 'my.sql'))
    const s = useWorkspace.getState()
    expect(s.tabs[1]).toMatchObject({ title: 'my.sql' })
    expect(s.tabs[1].savedQueryId).toBeUndefined()
    expect(s.queryStates[s.activeId].text).toBe('SELECT 5;\n')
  })
  it('toasts for oversized and non-UTF-8 files and opens no tab', async () => {
    const a = setup()
    await a.openFile(new File([new Uint8Array(1024 * 1024 + 1)], 'big.cql'))
    await a.openFile(new File([new Uint8Array([0xff, 0xfe])], 'bin.cql'))
    expect(toastMessages()).toEqual(['Could not open big.cql: The file is larger than 1 MiB.', 'Could not open bin.cql: The file is not valid UTF-8 text.'])
    expect(useWorkspace.getState().tabs).toHaveLength(1)
  })
  it('asks the host to show the picker', () => {
    setup().pickFile()
    expect(useQueryDialogs.getState().pickerNonce).toBe(1)
  })
})
