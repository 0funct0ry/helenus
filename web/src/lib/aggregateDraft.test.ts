import { initCondToJson } from './aggregateDraft'

describe('initCondToJson', () => {
  it('converts CQL literals to JSON values', () => {
    expect(initCondToJson('0')).toBe(0)
    expect(initCondToJson('(0, 0)')).toEqual([0, 0])
    expect(initCondToJson("'it''s'")).toBe("it's")
    expect(initCondToJson('[1, 2]')).toEqual([1, 2])
  })
  it('returns undefined when there is no JSON form', () => {
    expect(initCondToJson('')).toBeUndefined()
    expect(initCondToJson('{street: 1}')).toBeUndefined()
  })
})
