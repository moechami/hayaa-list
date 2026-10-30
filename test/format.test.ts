// Format v1/v2 writer and reader, against the shared fixtures. The vectors
// are the same ones the Hayaa app asserts in its TypeScript and Kotlin tests
// over the same committed files, which is what holds this writer to
// byte-level agreement with the phone's reader.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  adultListContains,
  adultListMatches,
  compileAdultList,
  compileHayaaList,
  decodeAdultList,
  decodeHayaaList,
  hayaaListContains,
  hayaaListMatches,
  normalizePathSegments,
  readAdultListHeader,
  readHayaaListHeader,
  reverseLabels,
} from '../src/format'
import { committed, compileFixtureV2, FIXTURE_BLOCK_SIZE, FIXTURE_HOSTS, FIXTURE_PATHS, FIXTURE_SERIAL } from './fixture'
import { assertMatch, each } from './helpers'

describe('reverseLabels', () => {
  test('reverses label order so a TLD sorts first', () => {
    assert.equal(reverseLabels('sub.example.com'), 'com.example.sub')
    assert.equal(reverseLabels(reverseLabels('a.b.c')), 'a.b.c')
  })
})

describe('v1 fixture (legacy format)', () => {
  const bytes = compileAdultList(FIXTURE_HOSTS, FIXTURE_BLOCK_SIZE)

  test('the committed adult-fixture.bin is exactly what the writer produces', () => {
    assert.deepEqual(Array.from(committed('adult-fixture.bin')), Array.from(bytes))
  })

  test('spans several blocks so block search is exercised', () => {
    assert.ok((readAdultListHeader(bytes)?.blockCount ?? 0) > 2)
  })

  each('finds every listed host', FIXTURE_HOSTS.map((h): [string] => [h]), (host) => {
    assert.equal(adultListContains(bytes, reverseLabels(host)), true)
    assert.equal(adultListMatches(bytes, host), true)
  })

  each(
    'subdomain rule',
    [
      ['www.example.com', true],
      ['deep.sub.other.net', true],
      ['x.a.b.c.d.org', true],
      ['gamma.example.org', true],
      ['Sub.OTHER.net', true],
    ] as const,
    (host, expected) => assert.equal(adultListMatches(bytes, host), expected),
  )

  each(
    'never matches an unlisted host',
    [['notexample.com'], ['example.net'], ['other.net'], ['b.c.d.org'], ['example.org'], ['delta.example.org'], ['zzz.tops'], ['aaa.aaa'], ['com']] as const,
    (host) => assert.equal(adultListMatches(bytes, host), false),
  )

  test('a target before the first block key is not found', () => {
    assert.equal(adultListContains(bytes, 'aaa'), false)
  })
})

describe('v2 writer', () => {
  test('writes the 32-byte header: version, flags, block size, counts, serial, host count, zero reserved', () => {
    const { bytes, stats } = compileHayaaList({ hosts: ['example.com'], paths: ['reddit.com/r/nsfw'], serial: 2026110101 })
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'HYAB')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    assert.equal(bytes[4], 2)
    assert.equal(bytes[5], 1)
    assert.equal(view.getUint16(6), 4096)
    assert.equal(view.getUint32(8), 2)
    assert.equal(view.getUint32(12), 1)
    assert.equal(view.getUint32(16), 2026110101)
    assert.equal(view.getUint32(20), 1)
    assert.deepEqual(Array.from(bytes.slice(24, 32)), [0, 0, 0, 0, 0, 0, 0, 0])
    assert.equal(view.getUint32(32), 36)
    assert.deepEqual(stats, { hosts: 1, paths: 1, pathsCoveredByHost: 0, pathsCoveredByPath: 0 })
  })

  test('leaves the paths flag clear when there are no page entries', () => {
    const { bytes } = compileHayaaList({ hosts: ['example.com'], serial: 0 })
    assertMatch(readHayaaListHeader(bytes), { version: 2, flags: 0, hasPaths: false, hostCount: 1, entryCount: 1 })
  })

  test('sorts hosts and paths into one key space and lowercases them', () => {
    const { bytes } = compileHayaaList({ hosts: ['SUB.Other.NET'], paths: ['Other.net/Gallery'], serial: 1 })
    assert.deepEqual(decodeHayaaList(bytes), { hosts: ['sub.other.net'], paths: ['other.net/gallery'] })
  })

  each(
    'rejects invalid input',
    [
      ['exämple.com', [], /ASCII/],
      ['a.com/x', [], /"\/"/],
      ['a.com?x', [], /'\?'/],
      ['example.com', ['reddit.com'], /host and a path/],
      ['example.com', ['/r/nsfw'], /host and a path/],
      ['example.com', ['reddit.com/a/b/c/d'], /1\.\.3/],
      ['example.com', ['reddit.com/r//nsfw'], /1\.\.3/],
      ['example.com', ['reddit.com/r/'], /1\.\.3/],
      ['example.com', ['reddit.com/r?x=1'], /'\?'/],
      ['example.com', ['reddit.com/r#top'], /'\?' or '#'/],
      ['example.com', ['localhost/r'], /two labels/],
      ['example.com', [`reddit.com/${'x'.repeat(250)}`], /length/],
    ] as [string, string[], RegExp][],
    (host, paths, error) => assert.throws(() => compileHayaaList({ hosts: [host], paths, serial: 0 }), error),
  )

  test('rejects a serial or block size that does not fit its field', () => {
    assert.throws(() => compileHayaaList({ hosts: ['a.com'], serial: 2 ** 32 }), /serial/)
    assert.throws(() => compileHayaaList({ hosts: ['a.com'], serial: -1 }), /serial/)
    assert.throws(() => compileHayaaList({ hosts: ['a.com'], serial: 0, blockSize: 70000 }), /block size/)
  })

  test('round-trips many hosts and paths across many blocks', () => {
    const hosts = Array.from({ length: 1500 }, (_, i) => `host${i}.sub${i % 7}.example${i % 13}.com`)
    const paths = Array.from({ length: 500 }, (_, i) => `site${i % 50}.net/p${i}/q${i % 3}`)
    const { bytes, stats } = compileHayaaList({ hosts, paths, serial: 7, blockSize: 256 })
    const header = readHayaaListHeader(bytes)
    assertMatch(header, { entryCount: 2000, hostCount: 1500, serial: 7, hasPaths: true })
    assert.ok((header?.blockCount ?? 0) > 10)
    assert.deepEqual(stats, { hosts: 1500, paths: 500, pathsCoveredByHost: 0, pathsCoveredByPath: 0 })
    const decoded = decodeHayaaList(bytes)
    assert.deepEqual(new Set(decoded.hosts), new Set(hosts))
    assert.deepEqual(new Set(decoded.paths), new Set(paths))
  })
})

describe('v2 fixture (the cross-language contract)', () => {
  const bytes = compileFixtureV2()

  test('the committed hayaa-list-fixture.bin is exactly what the writer produces', () => {
    assert.deepEqual(Array.from(committed('hayaa-list-fixture.bin')), Array.from(bytes))
  })

  test('header fields', () => {
    assert.deepEqual(readHayaaListHeader(bytes), {
      version: 2,
      flags: 1,
      blockSize: 48,
      entryCount: 14,
      blockCount: 4,
      serial: FIXTURE_SERIAL,
      hostCount: 10,
      hasPaths: true,
      headerBytes: 32,
    })
    assert.equal(bytes.length, 228)
  })

  test('drops the two redundant page entries and keeps the rest', () => {
    const { stats } = compileHayaaList({ hosts: FIXTURE_HOSTS, paths: FIXTURE_PATHS, serial: FIXTURE_SERIAL, blockSize: FIXTURE_BLOCK_SIZE })
    assert.deepEqual(stats, { hosts: 10, paths: 4, pathsCoveredByHost: 1, pathsCoveredByPath: 1 })
    const decoded = decodeHayaaList(bytes)
    assert.deepEqual(new Set(decoded.hosts), new Set(FIXTURE_HOSTS))
    assert.deepEqual(new Set(decoded.paths), new Set(['reddit.com/r/nsfw', 'imgur.com/a', 'tumblr.com/tagged/x/y', 'other.net/gallery']))
  })

  each(
    'contains',
    [
      ['com.reddit/r/nsfw', true],
      ['net.other/gallery', true],
      ['com.tumblr/tagged/x/y', true],
      ['com.example', true],
      ['net.other.sub', true],
      ['com.reddit/r/nsfw/top', false],
      ['com.example.www/some/page', false],
      ['com.reddit', false],
      ['aaa', false],
      ['', false],
    ] as const,
    (key, expected) => assert.equal(hayaaListContains(bytes, key), expected),
  )

  each('every listed host matches with no path', FIXTURE_HOSTS.map((h): [string] => [h]), (host) => {
    assert.equal(hayaaListMatches(bytes, host), true)
    assert.equal(hayaaListMatches(bytes, host, null), true)
  })

  each(
    'host rule',
    [
      ['www.example.com', true],
      ['deep.sub.other.net', true],
      ['x.a.b.c.d.org', true],
      ['Sub.OTHER.net', true],
      ['example.com.', true],
      ['notexample.com', false],
      ['example.net', false],
      ['other.net', false],
      ['b.c.d.org', false],
      ['example.org', false],
      ['delta.example.org', false],
      ['zzz.tops', false],
      ['aaa.aaa', false],
      ['com', false],
      ['', false],
      ['.', false],
      ['reddit.com', false],
    ] as const,
    (host, expected) => assert.equal(hayaaListMatches(bytes, host), expected),
  )

  each(
    'page rule',
    [
      ['imgur.com', '/a', true],
      ['reddit.com', '/r/nsfw', true],
      ['tumblr.com', '/tagged/x/y', true],
      ['imgur.com', '/a/xyz', true],
      ['reddit.com', '/r/nsfw/comments/abc/title', true],
      ['reddit.com', '/r/nsfw/top', true],
      ['tumblr.com', '/tagged/x/y/z/w', true],
      ['other.net', '/gallery/1', true],
      ['old.reddit.com', '/r/nsfw', true],
      ['www.tumblr.com', '/tagged/x/y', true],
      ['REDDIT.com.', '/r/nsfw', true],
      ['reddit.com', '/R/NSFW/', true],
      ['reddit.com', '/r/nsfw?sort=new', true],
      ['reddit.com', '/r/nsfw#top', true],
      ['reddit.com', '//r//nsfw', true],
      ['reddit.com', 'r/nsfw', true],
      ['reddit.com', '/r/nsfwfoo', false],
      ['imgur.com', '/ab', false],
      ['other.net', '/galleryx', false],
      ['tumblr.com', '/tagged/x/yy', false],
      ['reddit.com', '/r', false],
      ['reddit.com', '/r?/nsfw', false],
      ['reddit.com', '/r#/nsfw', false],
      ['reddit.com', '/', false],
      ['reddit.com', '', false],
      ['reddit.com', '/r/sfw', false],
      ['reddit.com', '/x/r/nsfw', false],
      ['imgur.com', '/b/a', false],
      ['tumblr.com', '/tagged/x', false],
      ['notreddit.com', '/r/nsfw', false],
      ['reddit.co', '/r/nsfw', false],
      ['other.net', '/r/nsfw', false],
      ['com', '/r/nsfw', false],
      ['www.example.com', '/anything', true],
    ] as const,
    (host, path, expected) => assert.equal(hayaaListMatches(bytes, host, path), expected),
  )

  test('a page lookup with no path never matches a page entry', () => {
    assert.equal(hayaaListMatches(bytes, 'reddit.com', null), false)
    assert.equal(hayaaListMatches(bytes, 'reddit.com'), false)
  })

  test('non-ASCII input never matches, but ASCII parents and shorter prefixes still do', () => {
    assert.equal(hayaaListMatches(bytes, 'bücher.example.com'), true)
    assert.equal(hayaaListMatches(bytes, 'exämple.com'), false)
    assert.equal(hayaaListContains(bytes, 'com.exämple'), false)
    assert.equal(hayaaListMatches(bytes, 'reddit.com', '/r/nsfw/ü'), true)
    assert.equal(hayaaListMatches(bytes, 'reddit.com', '/r/nsfẅ'), false)
  })

  test('path normalization', () => {
    assert.deepEqual(normalizePathSegments('/R/NSFW/?x=1#top'), ['r', 'nsfw'])
    assert.deepEqual(normalizePathSegments('//a/b//c/d/e'), ['a', 'b', 'c'])
    assert.deepEqual(normalizePathSegments('?/a'), [])
  })
})

describe('reader robustness (fail open, never throw)', () => {
  const v2 = compileFixtureV2()
  const v1 = compileAdultList(FIXTURE_HOSTS, FIXTURE_BLOCK_SIZE)

  test('reads a v1 file through the v2 API, ignoring paths', () => {
    assert.deepEqual(readHayaaListHeader(v1), {
      version: 1,
      flags: 0,
      blockSize: 48,
      entryCount: 10,
      blockCount: 3,
      serial: 0,
      hostCount: 10,
      hasPaths: false,
      headerBytes: 16,
    })
    assert.equal(hayaaListMatches(v1, 'www.example.com', '/x'), true)
    assert.equal(hayaaListMatches(v1, 'reddit.com', '/r/nsfw'), false)
  })

  test('the v1-era API reads a v2 file', () => {
    assert.deepEqual(readAdultListHeader(v2), { blockSize: 48, entryCount: 14, blockCount: 4 })
    assert.equal(adultListMatches(v2, 'www.example.com'), true)
    assert.deepEqual(new Set(decodeAdultList(v2)), new Set(FIXTURE_HOSTS))
  })

  test('wrong magic or an unknown version matches nothing', () => {
    for (const [i, b] of [
      [0, 0x58],
      [4, 3],
      [4, 0],
    ]) {
      const bad = v2.slice()
      bad[i] = b
      assert.equal(readHayaaListHeader(bad), null)
      assert.equal(hayaaListMatches(bad, 'example.com'), false)
      assert.equal(hayaaListMatches(bad, 'reddit.com', '/r/nsfw'), false)
    }
  })

  test('a buffer truncated into the header or the block index matches nothing', () => {
    for (let n = 0; n < 32 + 4 * 4; n++) {
      const cut = v2.slice(0, n)
      assert.equal(readHayaaListHeader(cut), null)
      assert.equal(hayaaListMatches(cut, 'example.com'), false)
    }
  })

  test('a buffer truncated inside the blocks never throws and misses the cut keys', () => {
    for (let n = 48; n < v2.length; n++) {
      const cut = v2.slice(0, n)
      for (const [host, path] of [
        ['example.com', null],
        ['zzz.top', null],
        ['last.xyz', '/x'],
        ['tumblr.com', '/tagged/x/y'],
        ['reddit.com', '/r/nsfw'],
      ] as const) {
        assert.doesNotThrow(() => hayaaListMatches(cut, host, path))
      }
    }
    assert.equal(hayaaListMatches(v2.slice(0, v2.length - 1), 'last.xyz'), false)
    assert.equal(hayaaListMatches(v2, 'last.xyz'), true)
  })

  test('a block offset pointing past the end, or out of order, is refused', () => {
    const past = v2.slice()
    new DataView(past.buffer).setUint32(32 + 4 * 3, 10_000)
    assert.equal(readHayaaListHeader(past), null)
    const backwards = v2.slice()
    new DataView(backwards.buffer).setUint32(32 + 4 * 2, new DataView(v2.buffer).getUint32(32 + 4))
    assert.equal(readHayaaListHeader(backwards), null)
    assert.equal(hayaaListMatches(backwards, 'example.com'), false)
  })

  test('random corruption never throws', () => {
    let seed = 12345
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let round = 0; round < 500; round++) {
      const bad = v2.slice()
      for (let k = 0; k < 3; k++) bad[32 + rand(bad.length - 32)] = rand(256)
      assert.doesNotThrow(() => hayaaListMatches(bad, 'old.reddit.com', '/r/nsfw/x'))
      assert.doesNotThrow(() => hayaaListMatches(bad, 'a.b.c.d.org'))
    }
  })
})
