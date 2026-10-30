// SPDX-License-Identifier: GPL-3.0-or-later
//
// Bounded work per lookup and full validation, over hand-built files laid
// out exactly as given (the writer never produces them). The same cases run
// in the Hayaa app against its Kotlin reader, so both refuse the same files.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  compileAdultList,
  compileHayaaList,
  hayaaListContains,
  hayaaListMatches,
  MAX_BLOCK_SPAN,
  maxBlockSpan,
  maxScanSteps,
  readHayaaListHeader,
  validateHayaaList,
} from '../src/format'
import { committed } from './fixture'
import { each } from './helpers'

type CraftOptions = { entryCount?: number; hostCount?: number; flags?: number; blockSize?: number; serial?: number }

const asciiBytes = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))

const entry = (shared: number, suffix: string, suffixLen: number = suffix.length): number[] => [shared, suffixLen, ...asciiBytes(suffix)]

const repeats = (n: number): number[] => {
  const out = new Array<number>(2 * n)
  for (let i = 0; i < n; i++) {
    out[2 * i] = 1
    out[2 * i + 1] = 0
  }
  return out
}

const frontCode = (keys: readonly string[]): number[] => {
  const out: number[] = []
  let prev = ''
  keys.forEach((k, i) => {
    let shared = 0
    if (i > 0) while (shared < prev.length && shared < k.length && prev[shared] === k[shared]) shared++
    out.push(...entry(shared, k.slice(shared)))
    prev = k
  })
  return out
}

const craftRaw = (blocks: readonly number[][], o: CraftOptions & { entryCount: number; hostCount: number }): Uint8Array => {
  const base = 32 + 4 * blocks.length
  const out = new Uint8Array(base + blocks.reduce((n, b) => n + b.length, 0))
  const view = new DataView(out.buffer)
  out.set(asciiBytes('HYAB'), 0)
  out[4] = 2
  out[5] = o.flags ?? 1
  view.setUint16(6, o.blockSize ?? 4096)
  view.setUint32(8, o.entryCount)
  view.setUint32(12, blocks.length)
  view.setUint32(16, o.serial ?? 0)
  view.setUint32(20, o.hostCount)
  let cursor = base
  blocks.forEach((b, i) => {
    view.setUint32(32 + 4 * i, cursor)
    out.set(b, cursor)
    cursor += b.length
  })
  return out
}

const craft = (blocks: readonly string[][], o: CraftOptions = {}): Uint8Array => {
  const keys = blocks.flat()
  const paths = keys.filter((k) => k.includes('/')).length
  return craftRaw(blocks.map(frontCode), {
    ...o,
    entryCount: o.entryCount ?? keys.length,
    hostCount: o.hostCount ?? keys.length - paths,
    flags: o.flags ?? (paths > 0 ? 1 : 0),
  })
}

describe('bounded work per lookup', () => {
  test('the span cap is blockSize + one entry + slack, never above MAX_BLOCK_SPAN', () => {
    assert.equal(maxBlockSpan(0), 321)
    assert.equal(maxBlockSpan(4096), 4096 + 257 + 64)
    assert.equal(maxBlockSpan(0xffff), MAX_BLOCK_SPAN)
    assert.equal(MAX_BLOCK_SPAN, 65535 + 257)
    assert.equal(maxScanSteps(0xffff), 21931)
  })

  test('refuses at open one block covering 200k entries', () => {
    const giant = [...entry(0, 'a'), ...repeats(200_000), ...entry(0, 'com.example')]
    const bytes = craftRaw([giant], { entryCount: 200_002, hostCount: 200_002, flags: 0 })
    assert.equal(readHayaaListHeader(bytes), null)
    assert.equal(hayaaListMatches(bytes, 'www.example.com'), false)
    assert.equal(hayaaListContains(bytes, 'com.example'), false)
    assert.equal(validateHayaaList(bytes), 'header or block index refused')
  })

  test('the cap is exact: a block one byte wider than allowed is refused', () => {
    const at = craft([['a'.repeat(200), 'b'.repeat(117)]], { blockSize: 0 })
    const over = craft([['a'.repeat(200), 'b'.repeat(118)]], { blockSize: 0 })
    assert.equal(at.length - 36, 321)
    assert.notEqual(readHayaaListHeader(at), null)
    assert.equal(hayaaListContains(at, 'b'.repeat(117)), true)
    assert.equal(readHayaaListHeader(over), null)
    assert.equal(hayaaListContains(over, 'b'.repeat(118)), false)
  })

  test('a block with more entries than a valid block can hold stops scanning', () => {
    const block = [...entry(0, 'a'), ...repeats(32_000), ...entry(0, 'com.example')]
    const bytes = craftRaw([block], { entryCount: 32_002, hostCount: 32_002, flags: 0, blockSize: 0xffff })
    assert.notEqual(readHayaaListHeader(bytes), null)
    assert.equal(hayaaListContains(bytes, 'com.example'), false)
    assert.equal(hayaaListMatches(bytes, 'example.com'), false)
  })

  each('every file the writer makes passes the cap, with near-maximal keys', [[1], [48], [256], [4096]] as const, (blockSize) => {
    const hosts = Array.from({ length: 300 }, (_, i) => `${'x'.repeat(240)}.h${String(i).padStart(4, '0')}.com`)
    const paths = Array.from({ length: 50 }, (_, i) => `p${i}.net/${'s'.repeat(200)}/${i}`)
    const { bytes } = compileHayaaList({ hosts, paths, serial: 1, blockSize })
    assert.notEqual(readHayaaListHeader(bytes), null)
    assert.equal(validateHayaaList(bytes), null)
    for (const h of hosts.slice(0, 20)) assert.equal(hayaaListMatches(bytes, h), true)
    assert.equal(hayaaListMatches(bytes, 'p7.net', `/${'s'.repeat(200)}/7`), true)
  })
})

describe('validateHayaaList', () => {
  test('accepts both shared fixtures, writer output and the empty list', () => {
    assert.equal(validateHayaaList(committed('adult-fixture.bin')), null)
    assert.equal(validateHayaaList(committed('hayaa-list-fixture.bin')), null)
    assert.equal(validateHayaaList(compileAdultList([])), null)
    assert.equal(validateHayaaList(compileHayaaList({ hosts: [], serial: 0 }).bytes), null)
    assert.equal(validateHayaaList(craft([['com.a', 'com.a/x', 'com.b'], ['com.c/y/z/w']])), null)
  })

  const gapped = (): Uint8Array => {
    const ok = craft([['com.a']])
    const out = new Uint8Array(ok.length + 1)
    out.set(ok.subarray(0, 36))
    out.set(ok.subarray(36), 37)
    new DataView(out.buffer).setUint32(32, 37)
    return out
  }

  each(
    'refuses',
    [
      ['unsorted keys inside a block', () => craft([['com.b', 'com.a']]), 'keys not strictly increasing'],
      ['unsorted keys across blocks', () => craft([['com.b'], ['com.a']]), 'keys not strictly increasing'],
      ['a duplicate key', () => craft([['com.a', 'com.a']]), 'keys not strictly increasing'],
      ['a key after a longer key it is a prefix of', () => craft([['com.ab', 'com.a']]), 'keys not strictly increasing'],
      [
        'an entry crossing into the next block',
        () => craftRaw([entry(0, 'com.a', 9), entry(0, 'com.b')], { entryCount: 2, hostCount: 2, flags: 0 }),
        'entry crosses its block end',
      ],
      [
        'a block that starts with a shared prefix',
        () => craftRaw([entry(0, 'com.a'), entry(1, 'om.b')], { entryCount: 2, hostCount: 2, flags: 0 }),
        'block starts with a shared prefix',
      ],
      [
        'a shared prefix longer than the previous key',
        () => craftRaw([[...entry(0, 'c'), ...entry(5, 'x')]], { entryCount: 2, hostCount: 2, flags: 0 }),
        'shared prefix longer than the previous key',
      ],
      [
        'a key longer than 255 bytes',
        () => craftRaw([[...entry(0, 'a'.repeat(200)), ...entry(200, 'b'.repeat(100))]], { entryCount: 2, hostCount: 2, flags: 0 }),
        'key length out of range',
      ],
      ['an empty key', () => craftRaw([entry(0, '')], { entryCount: 1, hostCount: 1, flags: 0 }), 'key length out of range'],
      ['a non-ASCII key', () => craftRaw([[0, 5, ...asciiBytes('com.'), 0xe9]], { entryCount: 1, hostCount: 1, flags: 0 }), 'non-ASCII key'],
      ['an entry count below the real one', () => craft([['com.a', 'com.b']], { entryCount: 1, hostCount: 1 }), 'entry count differs from the header'],
      ['an entry count above the real one', () => craft([['com.a', 'com.b']], { entryCount: 3, hostCount: 3 }), 'entry count differs from the header'],
      ['a wrong host count', () => craft([['com.a', 'com.a/x']], { hostCount: 2 }), 'host count differs from the header'],
      ['a page key without the paths flag', () => craft([['com.a', 'com.a/x']], { flags: 0, hostCount: 2 }), 'page entry without the paths flag'],
      ['a page key four segments deep', () => craft([['com.a/b/c/d/e']]), 'page entry deeper than 3 segments'],
      ['a page key with an empty segment', () => craft([['com.a//b']]), 'empty page segment'],
      ['a page key ending in a slash', () => craft([['com.a/b/']]), 'empty page segment'],
      ['a page key without a host', () => craft([['/r/nsfw']]), 'page entry without a host'],
      ['a gap before the first block', gapped, 'gap before the first block'],
      ['bytes after an empty index', () => new Uint8Array([...compileHayaaList({ hosts: [], serial: 0 }).bytes, 0]), 'bytes after the block index'],
      ['bytes the open-time check refuses', () => new Uint8Array([1, 2, 3]), 'header or block index refused'],
    ] as [string, () => Uint8Array, string][],
    (_name, bytes, reason) => {
      const data = bytes()
      assert.equal(validateHayaaList(data), reason)
      assert.doesNotThrow(() => hayaaListMatches(data, 'www.a.com', '/x/y'))
    },
  )

  test('catches corruption the open-time check lets through', () => {
    const unsorted = craft([['com.zzz', 'com.example']])
    assert.notEqual(readHayaaListHeader(unsorted), null)
    assert.equal(hayaaListMatches(unsorted, 'example.com'), false)
    assert.equal(validateHayaaList(unsorted), 'keys not strictly increasing')
  })
})
