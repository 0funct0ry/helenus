import { DEFAULT_QUERY_TEXT, newQueryState, useWorkspace } from './workspace'
import * as inflight from '../api/inflight'

describe('query tab state', () => {
  beforeEach(() => useWorkspace.setState({ tabs: [], activeId: '', queryCount: 0, queryStates: {}, consistency: 'LOCAL_QUORUM' }))

  it('creates state for "New query here" with the keyspace and CQL', () => {
    useWorkspace.getState().newQuery({ keyspace: 'payments', cql: 'SELECT * FROM payments.merchants LIMIT 100;' })
    const id = useWorkspace.getState().activeId
    expect(useWorkspace.getState().queryStates[id]).toMatchObject({ keyspace: 'payments', text: 'SELECT * FROM payments.merchants LIMIT 100;', pageSize: 100, consistency: 'LOCAL_QUORUM' })
  })
  it('starts blank queries with the hint text and the current consistency', () => {
    useWorkspace.setState({ consistency: 'ONE' })
    useWorkspace.getState().newQuery()
    expect(useWorkspace.getState().queryStates[useWorkspace.getState().activeId]).toMatchObject({ text: DEFAULT_QUERY_TEXT, consistency: 'ONE' })
  })
  it('patches, creating state when missing', () => {
    useWorkspace.getState().patchQuery('x', { trace: true })
    expect(useWorkspace.getState().queryStates.x).toMatchObject({ trace: true, allowFiltering: false })
  })
  it('drops state and aborts the request when a tab closes', () => {
    const spy = vi.spyOn(inflight, 'abortInflight')
    useWorkspace.getState().newQuery()
    const id = useWorkspace.getState().activeId
    useWorkspace.getState().close(id)
    expect(spy).toHaveBeenCalledWith(id)
    expect(useWorkspace.getState().queryStates[id]).toBeUndefined()
  })
  it('newQueryState applies overrides', () => {
    expect(newQueryState({ pageSize: 50 }, 'ALL')).toMatchObject({ pageSize: 50, consistency: 'ALL', results: [] })
  })
})

describe('closeMany', () => {
  const tab = (id: string) => ({ id, kind: 'query' as const, title: id, keyspace: '', object: '', closable: true })
  const item = { id: 'i', kind: 'insert' } as never
  beforeEach(() =>
    useWorkspace.setState({
      tabs: ['a', 'b', 'c', 'd'].map(tab),
      activeId: 'c',
      queryCount: 4,
      queryStates: { a: newQueryState(), b: newQueryState() },
      columnViews: { a: {} as never },
      edits: { a: [item], c: [item] },
      editErrors: { a: { i: 'x' } },
    }),
  )
  const ids = () => useWorkspace.getState().tabs.map((t) => t.id)

  it('clears per-tab state, aborts requests and ignores unknown ids', () => {
    const spy = vi.spyOn(inflight, 'abortInflight')
    useWorkspace.getState().closeMany(['a', 'b', 'zz'])
    const s = useWorkspace.getState()
    expect(ids()).toEqual(['c', 'd'])
    expect(spy).toHaveBeenCalledWith('a')
    expect(spy).toHaveBeenCalledWith('b')
    expect(spy).not.toHaveBeenCalledWith('zz')
    expect(s.queryStates).toEqual({})
    expect(s.columnViews).toEqual({})
    expect(s.edits).toEqual({ c: [item] })
    expect(s.editErrors).toEqual({})
    expect(s.queryCount).toBe(4)
  })
  it('keeps the active tab when it survives', () => {
    useWorkspace.getState().closeMany(['a'], 'b')
    expect(useWorkspace.getState().activeId).toBe('c')
  })
  it('activates the target when the active tab is closed', () => {
    useWorkspace.getState().closeMany(['a', 'c', 'd'], 'b')
    expect(useWorkspace.getState().activeId).toBe('b')
  })
  it('leaves no active tab after closing all', () => {
    useWorkspace.getState().closeMany(['a', 'b', 'c', 'd'])
    expect(useWorkspace.getState()).toMatchObject({ tabs: [], activeId: '' })
  })
  it('updates state once', () => {
    let n = 0
    const un = useWorkspace.subscribe(() => n++)
    useWorkspace.getState().closeMany(['a', 'b', 'd'], 'c')
    un()
    expect(n).toBe(1)
  })
  it('close(id) still picks the neighbour', () => {
    useWorkspace.getState().close('c')
    expect(useWorkspace.getState().activeId).toBe('d')
  })
})

describe('saved query binding', () => {
  const row = { id: 7, name: 'reports/daily', global: false, version: 2 }
  beforeEach(() => useWorkspace.setState({ tabs: [], activeId: '', queryCount: 0, queryStates: {}, editorEpochs: {}, consistency: 'LOCAL_QUORUM' }))

  it('opens a bound tab with a title, binding and saved text', () => {
    useWorkspace.getState().newQuery({ cql: 'SELECT 1;', title: 'daily.cql', savedQueryId: 7, queryName: row.name, queryGlobal: false, savedText: 'SELECT 1;', savedVersion: 2 })
    const s = useWorkspace.getState()
    expect(s.tabs[0]).toMatchObject({ title: 'daily.cql', savedQueryId: 7, queryName: 'reports/daily' })
    expect(s.queryStates[s.activeId]).toMatchObject({ text: 'SELECT 1;', savedText: 'SELECT 1;', savedVersion: 2 })
  })
  it('leaves unbound tabs without saved text', () => {
    useWorkspace.getState().newQuery({ cql: 'SELECT 1;' })
    const s = useWorkspace.getState()
    expect(s.queryStates[s.activeId].savedText).toBeUndefined()
  })
  it('does not reuse the id of a restored tab', () => {
    useWorkspace.setState({ tabs: [{ id: 'query-1', kind: 'query', title: 'x', keyspace: '', object: '', closable: true }] })
    useWorkspace.getState().newQuery()
    expect(useWorkspace.getState().activeId).toBe('query-2')
  })
  it('binds an existing tab and titles it from the last segment', () => {
    useWorkspace.getState().newQuery({ cql: 'abc' })
    const id = useWorkspace.getState().activeId
    useWorkspace.getState().bindQuery(id, row, 'abc')
    const s = useWorkspace.getState()
    expect(s.tabs[0]).toMatchObject({ title: 'daily.cql', savedQueryId: 7, queryName: 'reports/daily', queryGlobal: false })
    expect(s.queryStates[id]).toMatchObject({ savedText: 'abc', savedVersion: 2 })
  })
  it('syncs renames to bound tabs and keeps a hidden change reportable', () => {
    const st = useWorkspace.getState()
    st.newQuery({ cql: 'a', savedQueryId: 7, queryName: 'old', savedText: 'a', savedVersion: 1, title: 'old.cql' })
    st.newQuery({ cql: 'b', savedQueryId: 7, queryName: 'old', savedText: 'b', savedVersion: 1, title: 'old.cql' })
    useWorkspace.getState().syncBoundQuery({ ...row, name: 'x/new', version: 3, text: 'a' })
    const s = useWorkspace.getState()
    expect(s.tabs.map((t) => [t.title, t.queryName])).toEqual([['new.cql', 'x/new'], ['new.cql', 'x/new']])
    expect(s.queryStates['query-1'].savedVersion).toBe(3)
    expect(s.queryStates['query-2'].savedVersion).toBe(1)
  })
  it('unbinds tabs on delete and reports their titles', () => {
    useWorkspace.getState().newQuery({ cql: 'a', savedQueryId: 7, queryName: 'daily', savedText: 'a', savedVersion: 1, title: 'daily.cql' })
    expect(useWorkspace.getState().unbindQuery(7)).toEqual(['daily.cql'])
    const s = useWorkspace.getState()
    expect(s.tabs[0].savedQueryId).toBeUndefined()
    expect(s.queryStates['query-1']).toMatchObject({ text: 'a', savedText: undefined })
    expect(useWorkspace.getState().unbindQuery(7)).toEqual([])
  })
  it('reloads text and bumps the editor epoch', () => {
    useWorkspace.getState().newQuery({ cql: 'a', savedQueryId: 7, savedText: 'a', savedVersion: 1 })
    useWorkspace.getState().reloadQuery('query-1', 'server', 4)
    const s = useWorkspace.getState()
    expect(s.queryStates['query-1']).toMatchObject({ text: 'server', savedText: 'server', savedVersion: 4 })
    expect(s.editorEpochs['query-1']).toBe(1)
  })
})
