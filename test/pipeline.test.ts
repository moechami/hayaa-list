// The build gates, end to end over a local input, plus reproducibility.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decodeHayaaList, hayaaListMatches, readHayaaListHeader, validateHayaaList } from '../src/format'
import { gunzip } from '../src/gzip'
import { validateManifest } from '../src/manifest'
import { GateError, runBuild, serialFor, sha256Hex, type BuildInput } from '../src/pipeline'
import { baseInput } from './synthetic'

const withData = (patch: Partial<BuildInput['data']>, extra: Partial<BuildInput> = {}): BuildInput => {
  const input = baseInput()
  return { ...input, ...extra, data: { ...input.data, ...patch } }
}

const assertGate = (input: BuildInput, message: RegExp): GateError => {
  let caught: unknown
  try {
    runBuild(input)
  } catch (e) {
    caught = e
  }
  assert.ok(caught instanceof GateError, `expected a GateError, got ${String(caught)}`)
  assert.match(caught.message, message)
  return caught
}

describe('a passing build', () => {
  const out = runBuild(baseInput())
  const full = out.files.get('hayaa-list-2026110101.bin')!
  const decoded = decodeHayaaList(full)

  test('writes the release files', () => {
    assert.deepEqual([...out.files.keys()].sort(), [
      'build-info.json',
      'hayaa-list-2026110101.bin',
      'hayaa-list-2026110101.bin.gz',
      'hayaa-list-2026110101.txt',
      'manifest.json',
      'starter.bin',
    ])
  })

  test('the list passes full validation and carries the serial and host count', () => {
    assert.equal(validateHayaaList(full), null)
    const h = readHayaaListHeader(full)!
    assert.equal(h.version, 2)
    assert.equal(h.serial, 2026110101)
    assert.equal(h.hostCount, decoded.hosts.length)
  })

  test('entries: parsed, www stripped, covered hosts and public suffixes dropped, allowlist applied before the dedupe', () => {
    assert.deepEqual(decoded.hosts.sort(), ['adult-cdn.com', 'adult-one.com', 'adult-three.net', 'adult-two.com', 'someone.blogspot.com', 'sub.platform.com'])
    assert.deepEqual(decoded.paths, ['reddit.com/r/adult'])
    assert.equal(out.report.counts.publicSuffixesDropped, 2)
    assert.equal(out.report.counts.allowlisted, 2) // platform.com (root) and ads.safe.org (subtree)
    assert.equal(out.report.sources[1].skippedLines, 1)
  })

  test('a platform root stays reachable while a listed site on it is blocked', () => {
    assert.equal(hayaaListMatches(full, 'platform.com'), false)
    assert.equal(hayaaListMatches(full, 'sub.platform.com'), true)
    assert.equal(hayaaListMatches(full, 'blogspot.com'), false)
    assert.equal(hayaaListMatches(full, 'someone.blogspot.com'), true)
  })

  test('the plain-text list equals the binary list', () => {
    const text = new TextDecoder().decode(out.files.get('hayaa-list-2026110101.txt'))
    assert.deepEqual(text.trim().split('\n'), [...decoded.hosts.sort(), ...decoded.paths])
  })

  test('gzip: deterministic header, inflates to the list', () => {
    const gz = out.files.get('hayaa-list-2026110101.bin.gz')!
    assert.deepEqual(Array.from(gz.slice(0, 8)), [0x1f, 0x8b, 8, 0, 0, 0, 0, 0])
    assert.equal(sha256Hex(gunzip(gz)), sha256Hex(full))
  })

  test('manifest: valid, and describes the files exactly', () => {
    const bytes = out.files.get('manifest.json')!
    assert.equal(validateManifest(bytes), null)
    const m = JSON.parse(new TextDecoder().decode(bytes))
    const gz = out.files.get('hayaa-list-2026110101.bin.gz')!
    assert.deepEqual(m.file, { name: 'hayaa-list-2026110101.bin.gz', size: full.length, sha256: sha256Hex(full), gzSize: gz.length, gzSha256: sha256Hex(gz) })
    assert.equal(m.hostCount, decoded.hosts.length)
    assert.deepEqual(m.canaries, [{ host: 'adult-one.com' }, { host: 'reddit.com', path: '/r/adult/x' }])
    assert.deepEqual(m.negatives, [{ host: 'google.com' }, { host: 'platform.com' }, { host: 'reddit.com', path: '/r/other' }])
  })

  test('starter list: popular registrable entries, exclusions skipped, extras added, strict subset, same serial', () => {
    assert.deepEqual(out.starter, ['adult-two.com', 'adult-one.com', 'adult-three.net'])
    const starter = out.files.get('starter.bin')!
    assert.equal(validateHayaaList(starter), null)
    assert.equal(readHayaaListHeader(starter)!.serial, 2026110101)
    const hosts = decodeHayaaList(starter).hosts
    assert.ok(hosts.every((h) => decoded.hosts.includes(h)))
    assert.ok(hosts.length < decoded.hosts.length)
  })
})

describe('reproducibility', () => {
  test('two builds from the same inputs give identical bytes, file by file', () => {
    const a = runBuild(baseInput())
    const b = runBuild(baseInput())
    for (const [name, bytes] of a.files) assert.equal(sha256Hex(bytes), sha256Hex(b.files.get(name)!), name)
  })

  test('the order of lines in a source does not change the output', () => {
    const shuffled = baseInput()
    shuffled.sources = shuffled.sources.map((s) => ({ ...s, text: s.text.split('\n').reverse().join('\n') }))
    const a = runBuild(baseInput())
    const b = runBuild(shuffled)
    assert.equal(sha256Hex(a.files.get('hayaa-list-2026110101.bin')!), sha256Hex(b.files.get('hayaa-list-2026110101.bin')!))
    assert.equal(sha256Hex(a.files.get('hayaa-list-2026110101.bin.gz')!), sha256Hex(b.files.get('hayaa-list-2026110101.bin.gz')!))
  })
})

describe('gates that fail the build', () => {
  test('a canary that does not match', () => {
    assertGate(withData({ canaries: 'adult-one.com\nnot-listed.com\n' }), /canary does not match: not-listed.com/)
  })

  test('no canaries at all', () => {
    assertGate(withData({ canaries: '# empty\n' }), /at least one/)
  })

  test('more than 20 canaries (the app refuses the manifest)', () => {
    assertGate(withData({ canaries: Array.from({ length: 21 }, () => 'adult-one.com').join('\n') }), /more than 20/)
  })

  test('a negative that is not on the allowlist', () => {
    assertGate(withData({ negatives: 'google.com\nadult-two.com\n' }), /negatives: "adult-two.com" is not on the allowlist/)
  })

  test('a negative that matches through a listed parent, although the host itself is allowlisted', () => {
    assertGate(
      withData({ negatives: 'google.com\nx.adult-two.com\n', allowlist: baseInput().data.allowlist + 'x.adult-two.com\n' }),
      /negative matches: x.adult-two.com/,
    )
  })

  test('a top-sites list shorter than the gate expects', () => {
    assertGate({ ...baseInput(), trancoTop: 100 }, /expected 100/)
  })

  test('a public suffix as an addition', () => {
    assertGate(withData({ additions: 'co.uk\n' }), /additions: "co.uk" is a public suffix/)
    assertGate(withData({ additions: 'anything.ck\n' }), /public suffix/) // wildcard rule
  })

  test('an addition that is also allowlisted', () => {
    assertGate(withData({ additions: 'platform.com\n' }), /also on the allowlist/)
  })

  test('a page entry on a public suffix or under an allowlisted domain', () => {
    assertGate(withData({ paths: 'co.uk/x\n' }), /public suffix/)
    assertGate(withData({ paths: 'x.safe.org/y\n' }), /allowlisted/)
  })

  test('a malformed page entry', () => {
    assert.throws(() => runBuild(withData({ paths: 'reddit.com/a/b/c/d\n' })), /1\.\.3/)
  })

  test('hand-kept hosts must be normalized', () => {
    assertGate(withData({ additions: 'www.adult-four.com\n' }), /not a normalized host/)
    assertGate(withData({ allowlist: 'https://platform.com\n' }), /not a normalized host/)
  })

  test('a starter extra that is not in the full list, or is excluded', () => {
    assertGate(withData({ starterExtra: 'not-listed.com\n' }), /not an entry of the full list/)
    assertGate(withData({ starterExtra: 'adult-cdn.com\n' }), /also in starter-exclude/)
  })
})

describe('serial', () => {
  test('YYYYMMDD of the UTC date times 100 plus the run number', () => {
    assert.equal(serialFor(new Date(Date.UTC(2026, 10, 1, 23, 59)), 1), 2026110101)
    assert.equal(serialFor(new Date(Date.UTC(2026, 11, 31)), 99), 2026123199)
    assert.throws(() => serialFor(new Date(), 0), /1\.\.99/)
    assert.throws(() => serialFor(new Date(), 100), /1\.\.99/)
  })
})
