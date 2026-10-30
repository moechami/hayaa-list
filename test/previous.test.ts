// The previous release: read from a folder (CI download or local dist/), and
// fetched from GitHub with "no release yet" told apart from an API error.

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { serialProblem } from '../scripts/check-serial'
import {
  fetchPreviousRelease,
  latestRelease,
  parseBuildInfo,
  parseListText,
  readPreviousDir,
  releaseSerials,
  serializeBuildInfo,
  type BuildInfo,
  type FetchLike,
} from '../src/previous'

const tmp = mkdtempSync(join(tmpdir(), 'hayaa-list-prev-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const INFO: BuildInfo = {
  buildInfoVersion: 1,
  serial: 2026110101,
  hostCount: 2,
  pathCount: 1,
  sources: [{ id: 's', commit: 'c'.repeat(40), sha256: 'a'.repeat(64), lines: 3, hosts: 2, skippedLines: 1 }],
  heldBack: { topSites: ['new-top.com'], topSiteSubdomains: [] },
}

const dir = (files: Record<string, string>): string => {
  const d = mkdtempSync(join(tmp, 'd-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text)
  return d
}

describe('build-info.json', () => {
  test('round trip, fixed key order, final newline', () => {
    const text = new TextDecoder().decode(serializeBuildInfo(INFO))
    assert.ok(text.endsWith('}\n'))
    assert.deepEqual(parseBuildInfo(text), INFO)
  })

  test('a damaged file is refused, never read as empty', () => {
    assert.throws(() => parseBuildInfo('{}'), /buildInfoVersion/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, hostCount: -1 })), /bad counts/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, heldBack: { topSites: [1] } })), /heldBack/)
    assert.throws(() => parseBuildInfo('not json'))
  })
})

describe('reading a previous release from a folder', () => {
  test('host entries of the plain-text list, page entries skipped', () => {
    assert.deepEqual([...parseListText('a.com\r\nb.com\nreddit.com/r/x\n\n')], ['a.com', 'b.com'])
  })

  test('no folder, or no list in it: no previous release', () => {
    assert.equal(readPreviousDir(join(tmp, 'missing')), null)
    assert.equal(readPreviousDir(dir({ 'other.txt': 'x' })), null)
  })

  test('with build-info.json: the list it names', () => {
    const p = readPreviousDir(dir({ 'build-info.json': JSON.stringify(INFO), 'hayaa-list-2026110101.txt': 'a.com\nb.com\n', 'hayaa-list-2026120101.txt': 'z.com\n' }))!
    assert.deepEqual([...p.hosts].sort(), ['a.com', 'b.com'])
    assert.equal(p.info?.serial, 2026110101)
  })

  test('build-info.json naming a list that is missing is an error', () => {
    assert.throws(() => readPreviousDir(dir({ 'build-info.json': JSON.stringify(INFO) })), /missing/)
  })

  test('an older release without build-info.json: the newest list, no counts', () => {
    const p = readPreviousDir(dir({ 'hayaa-list-2026100101.txt': 'old.com\n', 'hayaa-list-2026110101.txt': 'new.com\n' }))!
    assert.deepEqual([...p.hosts], ['new.com'])
    assert.equal(p.info, null)
  })
})

/** A fake fetch over a URL → answer table. */
const fakeFetch = (routes: Record<string, { status: number; body?: string | Uint8Array }>): FetchLike & { calls: string[] } => {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(url)
    const r = routes[url] ?? { status: 404 }
    const bytes = typeof r.body === 'string' ? new TextEncoder().encode(r.body) : (r.body ?? new Uint8Array())
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer,
    }
  }) as FetchLike & { calls: string[] }
  f.calls = calls
  return f
}

const LATEST = 'https://api.github.com/repos/o/r/releases/latest'
const asset = (name: string): { name: string; browser_download_url: string } => ({ name, browser_download_url: `https://dl/${name}` })

describe('fetching the previous release from GitHub', () => {
  test('HTTP 404: the repository has no release yet', async () => {
    const f = fakeFetch({ [LATEST]: { status: 404 } })
    assert.equal(await latestRelease('o/r', undefined, f), null)
    const out = join(tmp, 'none')
    assert.equal(await fetchPreviousRelease('o/r', out, undefined, f), null)
    assert.deepEqual(readdirSync(out), [])
  })

  test('any other API failure throws (never mistaken for "no release")', async () => {
    for (const status of [401, 403, 500, 502]) {
      await assert.rejects(latestRelease('o/r', 't', fakeFetch({ [LATEST]: { status } })), new RegExp(`HTTP ${status}`))
    }
    await assert.rejects(latestRelease('o/r', 't', fakeFetch({ [LATEST]: { status: 200, body: '{"oops":1}' } })), /unexpected/)
  })

  test('downloads the list, build-info.json and the lock', async () => {
    const f = fakeFetch({
      [LATEST]: {
        status: 200,
        body: JSON.stringify({ tag_name: 'v2026110101', assets: ['hayaa-list-2026110101.txt', 'build-info.json', 'sources.lock.json', 'starter.bin'].map(asset) }),
      },
      'https://dl/hayaa-list-2026110101.txt': { status: 200, body: 'a.com\n' },
      'https://dl/build-info.json': { status: 200, body: JSON.stringify(INFO) },
      'https://dl/sources.lock.json': { status: 200, body: '{}' },
    })
    const out = join(tmp, 'full')
    assert.equal(await fetchPreviousRelease('o/r', out, 'token', f), 'v2026110101')
    assert.deepEqual(readdirSync(out).sort(), ['build-info.json', 'hayaa-list-2026110101.txt', 'sources.lock.json'])
    assert.equal(readFileSync(join(out, 'hayaa-list-2026110101.txt'), 'utf8'), 'a.com\n')
    assert.ok(!f.calls.includes('https://dl/starter.bin'))
  })

  test('an older release without build-info.json is fine; one without its list is refused', async () => {
    const latest = (names: string[]): Record<string, { status: number; body: string }> => ({
      [LATEST]: { status: 200, body: JSON.stringify({ tag_name: 'v2026110101', assets: names.map(asset) }) },
      'https://dl/hayaa-list-2026110101.txt': { status: 200, body: 'a.com\n' },
    })
    assert.equal(await fetchPreviousRelease('o/r', join(tmp, 'old'), undefined, fakeFetch(latest(['hayaa-list-2026110101.txt']))), 'v2026110101')
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'broken'), undefined, fakeFetch(latest(['manifest.json']))), /has no hayaa-list-2026110101.txt/)
  })

  test('a failed asset download throws', async () => {
    const f = fakeFetch({
      [LATEST]: { status: 200, body: JSON.stringify({ tag_name: 'v2026110101', assets: [asset('hayaa-list-2026110101.txt')] }) },
      'https://dl/hayaa-list-2026110101.txt': { status: 503 },
    })
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'fail'), undefined, f), /HTTP 503/)
  })
})

describe('the serial must be newer than every release', () => {
  const page = (n: number): string => `https://api.github.com/repos/o/r/releases?per_page=100&page=${n}`

  test('no releases: an empty list, and any serial passes', async () => {
    assert.deepEqual(await releaseSerials('o/r', undefined, fakeFetch({ [page(1)]: { status: 200, body: '[]' } })), [])
    assert.equal(serialProblem('2026110101', []), null)
  })

  test('an API error fails instead of passing', async () => {
    await assert.rejects(releaseSerials('o/r', undefined, fakeFetch({ [page(1)]: { status: 500 } })), /HTTP 500/)
    await assert.rejects(releaseSerials('o/r', undefined, fakeFetch({})), /HTTP 404/)
  })

  test('every page is read; only v<serial> tags count', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ tag_name: `v20260101${String(i % 100).padStart(2, '0')}` }))
    const f = fakeFetch({
      [page(1)]: { status: 200, body: JSON.stringify(full) },
      [page(2)]: { status: 200, body: JSON.stringify([{ tag_name: 'v2026120101' }, { tag_name: 'notes' }]) },
    })
    const serials = await releaseSerials('o/r', undefined, f)
    assert.equal(serials.length, 101)
    assert.equal(Math.max(...serials), 2026120101)
  })

  test('not newer, or malformed: refused', () => {
    assert.match(serialProblem('2026110101', [2026110101])!, /not newer/)
    assert.match(serialProblem('2026110101', [2026120101, 2026010101])!, /not newer than the latest release v2026120101/)
    assert.equal(serialProblem('2026110102', [2026110101]), null)
    assert.match(serialProblem('202611010', [])!, /bad serial/)
    assert.match(serialProblem('9999999999', [])!, /bad serial/)
  })
})

