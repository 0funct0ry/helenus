import { ParamField } from './ParamField'
import { paramValue, withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the boolean generator: the probability of true, from 0 to 1. */
export function BooleanParams({ spec, errors, onChange }: ParamsProps) {
  return (
    <ParamField
      label="Probability of true (0–1)"
      value={str(spec.params?.p_true)}
      placeholder="0.5"
      error={errors['params.p_true']}
      onChange={(t) => onChange(withParam(spec, 'p_true', paramValue(t)))}
    />
  )
}
