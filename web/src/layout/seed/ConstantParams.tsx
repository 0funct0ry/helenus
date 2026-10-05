import { ParamField } from './ParamField'
import { constantFromText, constantToText, withParam } from '../../lib/seedModel'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the constant generator: one value, parsed according to the column type. */
export function ConstantParams({ spec, type, errors, onChange }: ParamsProps) {
  return (
    <ParamField
      label="Value"
      mono
      value={constantToText(spec.params?.value)}
      error={errors['params.value']}
      onChange={(t) => onChange(withParam(spec, 'value', t === '' ? undefined : constantFromText(t, type)))}
    />
  )
}
