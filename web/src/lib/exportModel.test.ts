import { applyPreset, defaultExportFilename, DEFAULT_EXPORT_OPTIONS, optionsFor, presetColumns } from './exportModel'
import type { ExportPreset } from '../api/types'

const preset = (over: Partial<ExportPreset>): ExportPreset => ({
  id: 1, profile: '', name: 'Finance CSV', format: 'csv', options: { delimiter: ';' }, columns: ['id', 'amount', 'gone'], created_at: '', updated_at: '', ...over,
})

describe('exportModel', () => {
  it('builds the default filename in local time', () => {
    expect(defaultExportFilename('users', 'excel', new Date(2026, 9, 5, 9, 7))).toBe('users-20261005-0907.xlsx')
    expect(defaultExportFilename('', 'csv', new Date(2026, 0, 2, 13, 45))).toBe('query-20260102-1345.csv')
  })
  it('lists only the options a format uses', () => {
    expect(optionsFor('csv')).toContain('delimiter')
    expect(optionsFor('excel')).toEqual(['header'])
    expect(optionsFor('json')).toEqual([])
  })
  it('applies a preset and reports missing columns', () => {
    const r = applyPreset(preset({}), ['id', 'amount', 'note'])
    expect(r.selected).toEqual(['id', 'amount'])
    expect(r.missing).toEqual(['gone'])
    expect(r.options).toEqual({ ...DEFAULT_EXPORT_OPTIONS, delimiter: ';' })
  })
  it('selects every column when the preset has none stored', () => {
    const r = applyPreset(preset({ columns: null }), ['a', 'b'])
    expect(r.selected).toEqual(['a', 'b'])
    expect(r.missing).toEqual([])
  })
  it('stores null when all columns are checked', () => {
    expect(presetColumns(['a', 'b'], ['a', 'b'])).toBeNull()
    expect(presetColumns(['a'], ['a', 'b'])).toEqual(['a'])
  })
})
