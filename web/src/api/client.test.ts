import { ApiError, api, describeError } from './client'
import { mockApi } from '../test/api'

describe('api client', () => {
  it('returns parsed JSON and resolves 204 to undefined', async () => {
    mockApi({ 'GET /x': { a: 1 }, 'DELETE /x': { status: 204 } })
    expect(await api('/x')).toEqual({ a: 1 })
    expect(await api('/x', { method: 'DELETE' })).toBeUndefined()
  })
  it('throws ApiError with code and detail', async () => {
    mockApi({ 'GET /x': { status: 502, body: { error: { code: 'connection_failed', message: 'boom', detail: { failed_stage: 'auth' } } } } })
    const err = await api('/x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 502, code: 'connection_failed', message: 'boom' })
    expect(describeError(err)).toBe('Failed at the auth stage: boom')
  })
  it('maps network failures to ApiError', async () => {
    const err = await api('/x').catch((e) => e)
    expect(err).toMatchObject({ code: 'network_error' })
    expect(describeError(new Error('plain'))).toBe('plain')
  })
})

describe('api abort', () => {
  it('maps an aborted request to a cancelled ApiError', async () => {
    globalThis.fetch = (() => Promise.reject(new DOMException('aborted', 'AbortError'))) as typeof fetch
    await expect(api('/x', { body: {}, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'cancelled', status: 499 })
  })
})
