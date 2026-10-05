import { ParamField } from './ParamField'
import { paramValue, withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the float, decimal and vector generators: min, max and the number of decimals. */
export function FloatRangeParams({ spec, errors, onChange }: ParamsProps) {
  const p = spec.params ?? {}
  return (
    <div className="flex flex-wrap gap-2">
      <ParamField label="Min" value={str(p.min)} error={errors['params.min']} onChange={(t) => onChange(withParam(spec, 'min', paramValue(t)))} />
      <ParamField label="Max" value={str(p.max)} error={errors['params.max']} onChange={(t) => onChange(withParam(spec, 'max', paramValue(t)))} />
      <ParamField label="Decimals" value={str(p.decimals)} placeholder="2" error={errors['params.decimals']} onChange={(t) => onChange(withParam(spec, 'decimals', paramValue(t)))} />
    </div>
  )
}
