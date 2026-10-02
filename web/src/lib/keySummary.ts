import type { Column } from './schemaModel'

/** `PK (a, b) · CK c DESC` summary shown on table hover. */
export function keySummary(columns: Column[]): string {
  const pk = columns.filter((c) => c.kind === 'partition').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const ck = columns.filter((c) => c.kind === 'clustering').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const pkText = pk.length === 1 ? pk[0].name : `(${pk.map((c) => c.name).join(', ')})`
  const ckText = ck.map((c) => `${c.name} ${c.order ?? 'ASC'}`).join(', ')
  return ck.length ? `PK ${pkText} · CK ${ckText}` : `PK ${pkText}`
}
