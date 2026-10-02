import type { SplitStatement } from '../api/types'

const enc = new TextEncoder()

/** UTF-8 byte offset of a UTF-16 string index. */
export function byteOffset(text: string, index: number): number {
  return enc.encode(text.slice(0, index)).length
}

/** UTF-16 index of a UTF-8 byte offset. */
export function charIndex(text: string, bytes: number): number {
  const b = enc.encode(text)
  return new TextDecoder().decode(b.slice(0, bytes)).length
}

/**
 * The statement the cursor is in: the one whose span contains the offset, else the nearest one before
 * it (cursor in trailing whitespace), else the first. Undefined for no statements.
 */
export function statementAt(statements: SplitStatement[], byte: number): SplitStatement | undefined {
  if (!statements.length) return undefined
  const hit = statements.find((s) => byte >= s.start && byte <= s.end)
  if (hit) return hit
  const before = statements.filter((s) => s.end < byte)
  return before.length ? before[before.length - 1] : statements[0]
}

const strip = (cql: string) =>
  cql
    .replace(/--[^\n]*|\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")

/** True when the statement is a SELECT (comments skipped). */
export function isSelect(cql: string): boolean {
  return /^\s*select\b/i.test(strip(cql))
}

/** True for lightweight transactions: INSERT ... IF NOT EXISTS, UPDATE/DELETE ... IF. */
export function hasIf(cql: string): boolean {
  return /\bif\b/i.test(strip(cql)) && /^\s*(insert|update|delete)\b/i.test(strip(cql))
}

/** Rewrite a SELECT as `SELECT COUNT(*)` over the same FROM/WHERE (drops LIMIT, ORDER BY, ALLOW FILTERING). Undefined if not a simple SELECT. */
export function toCount(cql: string): string | undefined {
  const s = cql.trim().replace(/;+\s*$/, '')
  const m = /^select\b[\s\S]*?\bfrom\b([\s\S]*)$/i.exec(s)
  if (!m) return undefined
  const rest = m[1].replace(/\s+allow\s+filtering\s*$/i, '').replace(/\s+limit\s+\d+\s*$/i, '').replace(/\s+order\s+by\s+[\s\S]*$/i, '')
  return `SELECT COUNT(*) FROM${rest};`
}

function anyStatement(text: string, pred: (stmt: string) => boolean): boolean {
  return strip(text).split(';').some(pred)
}

/** True if any statement in `text` is a SELECT; used to disable `ANY` consistency. */
export function textHasRead(text: string): boolean {
  return anyStatement(text, (s) => /^\s*select\b/i.test(s))
}

/** True if any statement in `text` is a lightweight transaction; used to show the serial selector. */
export function textHasIf(text: string): boolean {
  return anyStatement(text, (s) => /^\s*(insert|update|delete)\b/i.test(s) && /\bif\b/i.test(s))
}
