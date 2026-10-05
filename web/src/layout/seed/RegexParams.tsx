import { ParamField } from './ParamField'
import { withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/**
 * Parameter editor for the regex generator. The pattern uses Go syntax; `*`, `+` and `{n,}` repeat at most 8 times and
 * the result is cut at 1,024 characters. An invalid pattern shows Go's own message under the field.
 */
export function RegexParams({ spec, errors, onChange }: ParamsProps) {
  return (
    <ParamField
      label="Pattern"
      mono
      className="w-full"
      value={str(spec.params?.pattern)}
      placeholder="[A-Z]{3}-\d{4}"
      error={errors['params.pattern']}
      onChange={(t) => onChange(withParam(spec, 'pattern', t))}
    />
  )
}
