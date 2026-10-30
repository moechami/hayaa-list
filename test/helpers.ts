import assert from 'node:assert/strict'
import { test } from 'node:test'

/** One test per row, named after the row. */
export const each = <T extends readonly unknown[]>(name: string, rows: readonly T[], fn: (...row: T) => void): void => {
  for (const row of rows) test(`${name}: ${row.map((v) => JSON.stringify(v)).join(' ')}`, () => fn(...row))
}

/** Every key of `expected` equals the same key of `actual`. */
export const assertMatch = (actual: unknown, expected: Record<string, unknown>): void => {
  assert.ok(actual !== null && typeof actual === 'object')
  for (const [k, v] of Object.entries(expected)) assert.deepEqual((actual as Record<string, unknown>)[k], v, k)
}

export const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)
