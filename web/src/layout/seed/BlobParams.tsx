import { ParamField } from './ParamField'
import { paramValue, withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the random bytes generator: minimum and maximum length in bytes (up to 4096). */
export function BlobParams({ spec, errors, onChange }: ParamsProps) {
  const p = spec.params ?? {}
  return (
    <div className="flex flex-wrap gap-2">
      <ParamField label="Min bytes" value={str(p.min_len)} placeholder="8" error={errors['params.min_len']} onChange={(t) => onChange(withParam(spec, 'min_len', paramValue(t)))} />
      <ParamField label="Max bytes" value={str(p.max_len)} placeholder="32" error={errors['params.max_len']} onChange={(t) => onChange(withParam(spec, 'max_len', paramValue(t)))} />
    </div>
  )
}
