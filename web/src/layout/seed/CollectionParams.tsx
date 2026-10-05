import { ParamField } from './ParamField'
import { SeedGeneratorEditor } from './SeedGeneratorEditor'
import { paramValue, withParam } from '../../lib/seedModel'
import { str } from './paramsProps'
import type { ParamsProps } from './paramsProps'

/**
 * Parameter editor for list, set and map columns: the size range (at most 50) and the element generator; maps also
 * take a key generator. An unset element generator uses the default for the element type.
 */
export function CollectionParams({ spec, type, errors, onChange }: ParamsProps) {
  const p = spec.params ?? {}
  const map = type.name === 'map'
  const elementType = (map ? type.args?.[1] : type.args?.[0]) ?? { name: 'text' }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <ParamField label="Min size" value={str(p.min)} placeholder="0" error={errors['params.min']} onChange={(t) => onChange(withParam(spec, 'min', paramValue(t)))} />
        <ParamField label="Max size" value={str(p.max)} placeholder="3" error={errors['params.max']} onChange={(t) => onChange(withParam(spec, 'max', paramValue(t)))} />
      </div>
      {map && type.args?.[0] && (
        <SeedGeneratorEditor label="Key" type={type.args[0]} spec={spec.key} errors={sub(errors, 'key.')} onChange={(key) => onChange({ ...spec, key })} />
      )}
      <SeedGeneratorEditor label={map ? 'Value' : 'Element'} type={elementType} spec={spec.element} errors={sub(errors, 'element.')} onChange={(element) => onChange({ ...spec, element })} />
    </div>
  )
}

function sub(errors: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
  return out
}
