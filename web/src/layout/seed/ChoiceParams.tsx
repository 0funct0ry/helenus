import { ParamField } from './ParamField'
import { constantFromText, constantToText, paramValue } from '../../lib/seedModel'
import type { ParamsProps } from './paramsProps'

/**
 * Parameter editor for the choice generator. Values and optional weights are comma-separated lists; a value that
 * itself contains a comma can be entered as a JSON string in quotes.
 */
export function ChoiceParams({ spec, type, errors, onChange }: ParamsProps) {
  const values = (spec.params?.values as unknown[] | undefined) ?? []
  const weights = (spec.params?.weights as unknown[] | undefined) ?? []
  const set = (key: string, list: unknown[]) => {
    const params = { ...spec.params }
    if (list.length) params[key] = list
    else delete params[key]
    onChange({ ...spec, params })
  }
  const split = (t: string) => (t.trim() === '' ? [] : t.split(',').map((s) => s.trim()))
  return (
    <div className="flex flex-wrap gap-2">
      <ParamField
        label="Values (comma separated)"
        mono
        className="flex-[2]"
        value={values.map(constantToText).join(', ')}
        error={errors['params.values']}
        onChange={(t) => set('values', split(t).map((s) => constantFromText(s, type)))}
      />
      <ParamField
        label="Weights (optional)"
        mono
        value={weights.map(constantToText).join(', ')}
        placeholder="1, 1, 3"
        error={errors['params.weights']}
        onChange={(t) => set('weights', split(t).map(paramValue))}
      />
    </div>
  )
}
