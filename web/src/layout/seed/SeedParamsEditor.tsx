import { BlobParams } from './BlobParams'
import { BooleanParams } from './BooleanParams'
import { ChoiceParams } from './ChoiceParams'
import { CollectionParams } from './CollectionParams'
import { CompositeParams } from './CompositeParams'
import type { CompositeParamsProps } from './CompositeParams'
import { ConstantParams } from './ConstantParams'
import { DurationParams } from './DurationParams'
import { FakeParams } from './FakeParams'
import { FloatRangeParams } from './FloatRangeParams'
import { InetParams } from './InetParams'
import { IntRangeParams } from './IntRangeParams'
import { RegexParams } from './RegexParams'
import { SequenceParams } from './SequenceParams'
import { TimeRangeParams } from './TimeRangeParams'

/** Picks the parameter editor for `spec.gen`. Generators without parameters (uuid, null) render nothing. */
export function SeedParamsEditor(props: CompositeParamsProps) {
  switch (props.spec.gen) {
    case 'constant':
      return <ConstantParams {...props} />
    case 'sequence':
      return <SequenceParams {...props} />
    case 'int_range':
      return <IntRangeParams {...props} />
    case 'float_range':
    case 'decimal_range':
    case 'vector':
      return <FloatRangeParams {...props} />
    case 'boolean':
      return <BooleanParams {...props} />
    case 'choice':
      return <ChoiceParams {...props} />
    case 'time_range':
    case 'timeuuid':
      return <TimeRangeParams {...props} />
    case 'duration_range':
      return <DurationParams {...props} />
    case 'inet':
      return <InetParams {...props} />
    case 'blob':
      return <BlobParams {...props} />
    case 'regex':
      return <RegexParams {...props} />
    case 'fake':
      return <FakeParams {...props} />
    case 'collection':
      return <CollectionParams {...props} />
    case 'composite':
      return <CompositeParams {...props} />
    default:
      return null
  }
}
