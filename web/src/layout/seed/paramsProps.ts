import type { SeedSpec, TypeDesc } from '../../api/types'

/** Props shared by every generator parameter editor. */
export interface ParamsProps {
  spec: SeedSpec
  /** The CQL type of the column (or nested element) being filled. */
  type: TypeDesc
  /** Server errors keyed by the part after the generator path, such as `params.min`. */
  errors: Record<string, string>
  onChange: (spec: SeedSpec) => void
}

export const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
