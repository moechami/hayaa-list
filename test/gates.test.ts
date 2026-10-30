// The monthly gates added on top of the basic build: review gates that hold
// back new unreviewed popular entries (and fail on a burst of them), shrink
// gates against the previous release, the source format gate, the starter
// list's size and per-brand cap, and build-info.json.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decodeHayaaList, hayaaListMatches } from '../src/format'
import { GateError, brandKey, runBuild, sameBrand, type BuildInput } from '../src/pipeline'
import { parseBuildInfo, type BuildInfo, type PreviousRelease } from '../src/previous'
import { baseInput } from './synthetic'

const build = (patch: Partial<BuildInput> = {}, data: Partial<BuildInput['data']> = {}): ReturnType<typeof runBuild> => {
  const input = baseInput()
  return runBuild({ ...input, ...patch, data: { ...input.data, ...data } })
}

const gate = (fn: () => unknown, message: RegExp): GateError => {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  assert.ok(caught instanceof GateError, `expected a GateError, got ${String(caught)}`)
  assert.match(caught.message, message)
  return caught
}

const hostsOf = (out: ReturnType<typeof runBuild>): string[] => decodeHayaaList(out.files.get('hayaa-list-2026110101.bin')!).hosts.sort()

const info = (patch: Partial<BuildInfo> = {}): BuildInfo => ({
  buildInfoVersion: 1,
  serial: 2026100101,
  hostCount: 6,
  pathCount: 1,
  sources: [
    { id: 'hosts-format', commit: null, sha256: 'x', lines: 8, hosts: 7, skippedLines: 0 },
    { id: 'plain-format', commit: null, sha256: 'y', lines: 5, hosts: 4, skippedLines: 1 },
  ],
  heldBack: { topSites: [], topSiteSubdomains: [] },
  ...patch,
})

const previous = (hosts: string[], i: BuildInfo | null = null): PreviousRelease => ({ hosts: new Set(hosts), info: i, origin: 'test' })

// Reviewed only adult-one.com: adult-two.com and adult-cdn.com are unreviewed top sites.
const partlyReviewed = { reviewedTopHits: 'adult-one.com\n' }
// With two top sites held back, two popular starter picks are not available.
const smallStarter = { starterSize: 2 }

describe('review gate: top sites', () => {
  test('new unreviewed top sites are held back, the release still builds', () => {
    const out = build(smallStarter, partlyReviewed)
    assert.deepEqual(out.heldBack, { topSites: ['adult-cdn.com', 'adult-two.com'], topSiteSubdomains: [] })
    assert.deepEqual(hostsOf(out), ['adult-one.com', 'adult-three.net', 'someone.blogspot.com', 'sub.platform.com'])
    assert.equal(out.report.counts.newHeldBack, 2)
    assert.ok(out.report.warnings.some((w) => /held back/.test(w)))
  })

  test('an unreviewed top site the previous release listed stays listed', () => {
    const out = build({ ...smallStarter, previous: previous(['adult-two.com']) }, partlyReviewed)
    assert.deepEqual(out.heldBack.topSites, ['adult-cdn.com'])
    assert.deepEqual(out.keptFromPrevious, ['adult-two.com'])
    assert.ok(hostsOf(out).includes('adult-two.com'))
  })

  test('kept when the previous release blocked it through a parent too', () => {
    const out = build({ ...smallStarter, previous: previous(['adult-two.com', 'adult-cdn.com']) }, partlyReviewed)
    assert.deepEqual(out.heldBack.topSites, [])
  })

  test('more new held-back entries than allowed fails, listing them', () => {
    const e = gate(() => build({ ...smallStarter, maxNewHeldBack: 1 }, partlyReviewed), /2 new unreviewed popular entries \(more than 1\)/)
    assert.deepEqual(e.details, { file: 'held-back-candidates.txt', lines: ['adult-cdn.com', 'adult-two.com'] })
  })

  test('entries already held back by the previous release are not new: they stay held, the build passes', () => {
    const prev = previous([], info({ heldBack: { topSites: ['adult-cdn.com', 'adult-two.com'], topSiteSubdomains: [] } }))
    const out = build({ ...smallStarter, maxNewHeldBack: 0, previous: prev, allowShrink: true }, partlyReviewed)
    assert.deepEqual(out.heldBack.topSites, ['adult-cdn.com', 'adult-two.com'])
    assert.equal(out.report.counts.newHeldBack, 0)
  })

  test('holding a site back never unblocks a host under it that the previous release blocked', () => {
    const input = baseInput()
    input.sources = [...input.sources, { id: 'extra', text: 'old.adult-two.com\n' }]
    const out = runBuild({ ...input, ...smallStarter, previous: previous(['old.adult-two.com']), data: { ...input.data, ...partlyReviewed } })
    const full = out.files.get('hayaa-list-2026110101.bin')!
    assert.equal(hayaaListMatches(full, 'adult-two.com'), false)
    assert.equal(hayaaListMatches(full, 'old.adult-two.com'), true)
  })
})

describe('review gate: subdomains of the most popular sites', () => {
  test('an unreviewed one is held back (the site itself is untouched)', () => {
    const out = build({}, { reviewedTopSiteSubdomains: '' })
    assert.deepEqual(out.heldBack.topSiteSubdomains, ['sub.platform.com'])
    assert.ok(!hostsOf(out).includes('sub.platform.com'))
  })

  test('the previous release listed it: it stays', () => {
    const out = build({ previous: previous(['sub.platform.com']) }, { reviewedTopSiteSubdomains: '' })
    assert.deepEqual(out.heldBack.topSiteSubdomains, [])
    assert.deepEqual(out.keptFromPrevious, ['sub.platform.com'])
  })

  test('a "*." rule accepts every listed subdomain of a platform', () => {
    const out = build({}, { reviewedTopSiteSubdomains: '*.platform.com\n' })
    assert.deepEqual(out.heldBack.topSiteSubdomains, [])
    assert.ok(hostsOf(out).includes('sub.platform.com'))
  })

  test('only the top ranks are gated: below them a subdomain needs no review', () => {
    const out = build({ subdomainRanks: 3 }, { reviewedTopSiteSubdomains: '' })
    assert.deepEqual(out.heldBack.topSiteSubdomains, [])
  })

  test('a false positive goes on the allowlist (that host only)', () => {
    const out = build({}, { reviewedTopSiteSubdomains: '', allowlist: baseInput().data.allowlist + 'sub.platform.com\n' })
    assert.deepEqual(out.heldBack.topSiteSubdomains, [])
    assert.ok(!hostsOf(out).includes('sub.platform.com'))
  })

  test('counts toward the burst limit with the top sites', () => {
    gate(() => build({ ...smallStarter, maxNewHeldBack: 2 }, { ...partlyReviewed, reviewedTopSiteSubdomains: '' }), /3 new unreviewed/)
  })
})

describe('shrink gates against the previous release', () => {
  test('a list more than 10% smaller fails', () => {
    gate(() => build({ previous: previous([], info({ hostCount: 7 })) }), /shrank from 7 to 6 hosts/)
  })

  test('within 10% passes', () => {
    assert.doesNotThrow(() => build({ previous: previous([], info({ hostCount: 6 })) }))
  })

  test('a source more than 30% smaller fails', () => {
    const prev = info()
    prev.sources[1] = { ...prev.sources[1], hosts: 6 }
    gate(() => build({ previous: previous([], prev) }), /source plain-format shrank from 6 to 4 hosts/)
  })

  test('a source the previous release did not have is not compared', () => {
    const prev = info({ sources: [] })
    assert.doesNotThrow(() => build({ previous: previous([], prev) }))
  })

  test('allowShrink skips them (a reviewed removal)', () => {
    assert.doesNotThrow(() => build({ allowShrink: true, previous: previous([], info({ hostCount: 1000 })) }))
  })

  test('no build-info.json in the previous release: skipped', () => {
    assert.doesNotThrow(() => build({ previous: previous([]) }))
  })
})

describe('source format gate', () => {
  const withSource = (text: string): BuildInput => {
    const input = baseInput()
    return { ...input, sources: [...input.sources, { id: 'changed', text }] }
  }

  test('a source whose lines are mostly unreadable fails (a format change)', () => {
    const text = Array.from({ length: 200 }, (_, i) => `||site${i}.com^`).join('\n')
    gate(() => runBuild(withSource(text)), /source changed: 200 of 200 lines unreadable/)
  })

  test('a few unreadable lines in a large source pass', () => {
    const good = Array.from({ length: 20_000 }, (_, i) => `site${i}.com`)
    const bad = Array.from({ length: 150 }, (_, i) => `bad_${i}.com`)
    const out = runBuild(withSource([...good, ...bad].join('\n')))
    assert.equal(out.report.sources[2].skippedLines, 150)
    assert.equal(out.report.sources[2].lines, 20_150)
  })

  test('an over-long line is skipped, never crashes the build', () => {
    const long = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.com` // 248 chars
    const tooLong = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com` // 259 chars
    const out = runBuild(withSource(`${long}\n${tooLong}\n`))
    assert.equal(out.report.sources[2].hosts, 1)
    assert.equal(out.report.sources[2].skippedLines, 1)
  })
})

describe('starter list', () => {
  test('exactly starterSize entries, or the build fails', () => {
    gate(() => build({ starterSize: 4 }), /starter list has 3 entries, expected exactly 4/)
  })

  test('at most starterPerBrand per brand, the next distinct site fills the slot', () => {
    // All synthetic sites are brand "adult": with a cap of 2, the extra cannot fit.
    gate(() => build({ starterPerBrand: 2 }), /starter-extra: "adult-three.net" is over the 2-per-brand cap/)
    const out = build({ starterPerBrand: 1, starterSize: 1 }, { starterExtra: '' })
    assert.deepEqual(out.starter, ['adult-two.com'])
  })

  test('data/starter-brands.txt names the brand of mirrors', () => {
    // One per brand: adult-one.com shares adult-two.com's brand, so only one popular pick fits...
    gate(() => build({ starterPerBrand: 1, starterSize: 2 }, { starterExtra: '' }), /has 1 entries, expected exactly 2/)
    // ...until the brands file gives adult-two.com a brand of its own.
    const out = build({ starterPerBrand: 1, starterSize: 2 }, { starterExtra: '', starterBrands: 'adult-two.com other\n' })
    assert.deepEqual(out.starter, ['adult-two.com', 'adult-one.com'])
    gate(() => build({}, { starterBrands: 'adult-two.com\n' }), /must be a domain and a brand/)
  })

  test('no proxy or bypass site in the starter list', () => {
    const input = baseInput()
    input.sources = [...input.sources, { id: 'proxy', text: 'adultproxy.net\n' }]
    input.tranco = '1,adultproxy.net\r\n' + input.tranco
    input.trancoTop = 6 // keep adult-one.com, now sixth, in the ranking
    input.data = { ...input.data, reviewedTopHits: input.data.reviewedTopHits + 'adultproxy.net\n' }
    gate(() => runBuild(input), /"adultproxy.net" looks like a proxy or bypass site/)
    input.data = { ...input.data, starterExclude: input.data.starterExclude + 'adultproxy.net\n' }
    assert.deepEqual(runBuild(input).starter, ['adult-two.com', 'adult-one.com', 'adult-three.net'])
  })

  test('brand keys: digits, mirrors and hyphenated tails', () => {
    assert.equal(brandKey('xhamster46.desi'), 'xhamster')
    assert.equal(brandKey('faphouse2.com'), 'faphouse')
    assert.equal(brandKey('xvideos-cdn.com'), 'xvideos')
    assert.equal(brandKey('e621.net'), 'e621')
    assert.equal(brandKey('e-hentai.org'), 'e-hentai')
    assert.equal(brandKey('sex-studentki.team'), 'sex-studentki')
    assert.ok(sameBrand('xhamster', 'xhamsterlive'))
    assert.ok(sameBrand('xnxx', 'xnxx'))
    assert.ok(!sameBrand('porn', 'pornhub')) // too short to be a family
    assert.ok(!sameBrand('e621', 'e-hentai'))
  })
})

describe('build-info.json', () => {
  test('per-source counts and the held-back entries, parseable by the next build', () => {
    const out = build(smallStarter, partlyReviewed)
    const parsed = parseBuildInfo(new TextDecoder().decode(out.files.get('build-info.json')))
    assert.equal(parsed.serial, 2026110101)
    assert.equal(parsed.hostCount, 4)
    assert.deepEqual(
      parsed.sources.map((s) => [s.id, s.lines, s.hosts, s.skippedLines]),
      [
        ['hosts-format', 8, 7, 1], // "127.0.0.1 localhost" is skipped
        ['plain-format', 5, 4, 1],
      ],
    )
    assert.deepEqual(parsed.heldBack.topSites, ['adult-cdn.com', 'adult-two.com'])
  })

  test('the manifest the app parses carries none of it', () => {
    const m = JSON.parse(new TextDecoder().decode(build().files.get('manifest.json')))
    assert.deepEqual(Object.keys(m), ['format', 'serial', 'keyId', 'file', 'hostCount', 'canaries', 'negatives'])
  })

  test('a build compared against itself gives the same bytes (idempotent hold-back)', () => {
    const first = build(smallStarter, partlyReviewed)
    const text = new TextDecoder().decode(first.files.get('hayaa-list-2026110101.txt'))
    const prev: PreviousRelease = {
      hosts: new Set(text.split('\n').filter((l) => l && !l.includes('/'))),
      info: parseBuildInfo(new TextDecoder().decode(first.files.get('build-info.json'))),
      origin: 'first',
    }
    const second = build({ ...smallStarter, previous: prev, maxNewHeldBack: 0 }, partlyReviewed)
    for (const [name, bytes] of first.files) assert.deepEqual(second.files.get(name), bytes, name)
  })
})
