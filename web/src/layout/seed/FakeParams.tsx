import { Select } from '../../ui/Select'
import { FAKE_CATEGORIES, withParam } from '../../lib/seedModel'
import type { ParamsProps } from './paramsProps'

/** Parameter editor for the fake data generator: the category (name, email, city, …) filtered by the column type. */
export function FakeParams({ spec, type, errors, onChange }: ParamsProps) {
  const allowed = type.name === 'inet' ? ['ipv4', 'ipv6'] : type.name === 'date' ? ['birthdate'] : FAKE_CATEGORIES
  const value = (spec.params?.category as string) ?? allowed[0]
  return (
    <div className="flex flex-col gap-1">
      <Select aboveDialog label="Category" mono value={value} options={allowed.map((c) => ({ value: c, label: c }))} onChange={(v) => onChange(withParam(spec, 'category', v))} />
      {errors['params.category'] && (
        <p role="alert" className="m-0 text-xs text-danger">
          {errors['params.category']}
        </p>
      )}
    </div>
  )
}
