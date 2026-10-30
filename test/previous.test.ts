// SPDX-License-Identifier: GPL-3.0-or-later
//
// The previous release: read only from signed files (the manifest, the list
// file it names, build-info.json), with the host set decoded from the signed
// list; fetched from GitHub with every signature checked and "no release yet"
// told apart from an API error.

import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { serialProblem } from '../scripts/check-serial'
import { parseLock } from '../src/lock'
import { validateManifest } from '../src/manifest'
import { runBuild } from '../src/pipeline'
import {
  fetchPreviousRelease,
  latestRelease,
  parseBuildInfo,
  previousAssetNames,
  readPreviousDir,
  readPublicKeys,
  releaseSerials,
  serializeBuildInfo,
  type BuildInfo,
  type FetchLike,
} from '../src/previous'
import { signManifest } from '../src/signing'
import { SYNTHETIC_LOCK, baseInput } from './synthetic'

const tmp = mkdtempSync(join(tmpdir(), 'hayaa-list-prev-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const INFO: BuildInfo = {
  buildInfoVersion: 3,
  serial: 2026110101,
  hostCount: 2,
  pathCount: 1,
  hostCountHistory: [3, 2],
  sources: [{ id: 's', commit: 'c'.repeat(40), sha256: 'a'.repeat(64), lines: 3, hosts: 2, skippedLines: 1 }],
  heldBackEduGov: [],
  heldBack: { topSites: ['new-top.com'], topSiteSubdomains: [] },
  gateOverrides: { allowShrink: false, allowGrowth: true },
  sourcesLockSha256: 'a'.repeat(64),
}

const keyPair = (): { priv: string; pub: string } => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return { priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}
const key = keyPair()
const otherKey = keyPair()
const keys = new Map([['k1', key.pub]])

/** A real release folder from the synthetic build, signed with `priv` (or unsigned). */
const releaseDir = (priv: string | null, edit?: (dir: string) => void): string => {
  const d = mkdtempSync(join(tmp, 'rel-'))
  const out = runBuild(baseInput())
  for (const [name, bytes] of out.files) writeFileSync(join(d, name), bytes)
  writeFileSync(join(d, 'sources.lock.json'), SYNTHETIC_LOCK)
  if (priv) for (const name of ['manifest.json', 'build-info.json', 'sources.lock.json']) writeFileSync(join(d, `${name}.sig`), signManifest(readFileSync(join(d, name)), priv))
  edit?.(d)
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
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, buildInfoVersion: 1 })), /buildInfoVersion/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, buildInfoVersion: 2 })), /buildInfoVersion/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, gateOverrides: { allowShrink: 'no', allowGrowth: false } })), /gateOverrides/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, gateOverrides: undefined })), /gateOverrides/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, sourcesLockSha256: 'A'.repeat(64) })), /sourcesLockSha256/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, hostCount: -1 })), /bad counts/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, heldBack: { topSites: [1] } })), /heldBack/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, hostCountHistory: [] })), /hostCountHistory/)
    assert.throws(() => parseBuildInfo(JSON.stringify({ ...INFO, hostCountHistory: [5] })), /hostCountHistory/) // must end with hostCount
    assert.throws(() => parseBuildInfo('not json'))
  })
})

describe('domain separation: each signed file is refused by the readers of the other two', () => {
  // The same key signs all three, so a signature over one must never let it pass as another.
  const d = releaseDir(null)
  const realLock = readFileSync(join(__dirname, '..', 'sources.lock.json'), 'utf8')
  const manifest = readFileSync(join(d, 'manifest.json'))
  const buildInfo = readFileSync(join(d, 'build-info.json'))

  test('the real files pass their own readers', () => {
    assert.equal(validateManifest(new Uint8Array(manifest)), null)
    assert.equal(parseBuildInfo(buildInfo.toString('utf8')).serial, 2026110101)
    assert.equal(parseLock(realLock).lockVersion, 1)
  })

  test('the manifest reader (format 2, the app\'s rules) refuses build-info.json and the lock', () => {
    assert.equal(validateManifest(new Uint8Array(buildInfo)), 'format must be 2')
    assert.notEqual(validateManifest(new TextEncoder().encode(realLock)), null)
    assert.equal(validateManifest(new TextEncoder().encode(JSON.stringify(JSON.parse(realLock), null, 2) + '\n')), 'format must be 2')
  })

  test('the build-info reader refuses the manifest and the lock, even with a buildInfoVersion added', () => {
    assert.throws(() => parseBuildInfo(manifest.toString('utf8')), /another signed file/)
    assert.throws(() => parseBuildInfo(realLock), /another signed file/)
    const lockWithVersion = JSON.stringify({ ...JSON.parse(realLock), buildInfoVersion: 3 })
    assert.throws(() => parseBuildInfo(lockWithVersion), /another signed file/)
  })

  test('the lock reader refuses the manifest and build-info.json, even with a lockVersion added', () => {
    assert.throws(() => parseLock(manifest.toString('utf8')), /another signed file/)
    assert.throws(() => parseLock(buildInfo.toString('utf8')), /another signed file/)
    assert.throws(() => parseLock(JSON.stringify({ ...JSON.parse(buildInfo.toString('utf8')), lockVersion: 1 })), /another signed file/)
    assert.throws(() => parseLock('{"sources":[]}'), /unknown lockVersion/)
  })
})

describe('reading a previous release from a folder', () => {
  test('signed: the host set is decoded from the signed list, not the plain text', () => {
    const d = releaseDir(key.priv, (dir) => writeFileSync(join(dir, 'hayaa-list-2026110101.txt'), 'forged.com\n'))
    const p = readPreviousDir(d, keys)!
    assert.deepEqual([...p.hosts].sort(), ['adult-cdn.com', 'adult-one.com', 'adult-three.net', 'adult-two.com', 'someone.blogspot.com', 'sub.platform.com'])
    assert.equal(p.info.serial, 2026110101)
    assert.match(p.origin, /signatures verified/)
  })

  test('signed mode refuses a missing or wrong signature on the manifest or build-info.json', () => {
    assert.throws(() => readPreviousDir(releaseDir(null), keys), /manifest.json.sig is missing/)
    assert.throws(() => readPreviousDir(releaseDir(otherKey.priv), keys), /manifest.json.sig does not verify/)
    const forgedInfo = releaseDir(key.priv, (dir) => {
      const info = parseBuildInfo(readFileSync(join(dir, 'build-info.json'), 'utf8'))
      writeFileSync(join(dir, 'build-info.json'), serializeBuildInfo({ ...info, sources: [] }))
    })
    assert.throws(() => readPreviousDir(forgedInfo, keys), /build-info.json.sig does not verify/)
    assert.throws(() => readPreviousDir(releaseDir(key.priv), new Map()), /no public keys/)
  })

  test('the signed lock must be the one the signed build-info.json names', () => {
    const swapped = releaseDir(key.priv, (dir) => {
      const other = '{"lockVersion":1,"from":"another release"}\n'
      writeFileSync(join(dir, 'sources.lock.json'), other)
      writeFileSync(join(dir, 'sources.lock.json.sig'), signManifest(new TextEncoder().encode(other), key.priv))
    })
    assert.throws(() => readPreviousDir(swapped, keys), /sources.lock.json is not the lock build-info.json names/)
    assert.throws(() => readPreviousDir(releaseDir(key.priv, (dir) => rmSync(join(dir, 'sources.lock.json'))), keys), /sources.lock.json is missing/)
    assert.throws(() => readPreviousDir(releaseDir(key.priv, (dir) => rmSync(join(dir, 'sources.lock.json.sig'))), keys), /sources.lock.json.sig is missing/)
    // A local dist/ has no lock: nothing to pair. One that is there must match.
    assert.ok(readPreviousDir(releaseDir(null, (dir) => rmSync(join(dir, 'sources.lock.json'))), null))
    assert.throws(() => readPreviousDir(releaseDir(null, (dir) => writeFileSync(join(dir, 'sources.lock.json'), '{}\n')), null), /is not the lock/)
  })

  test('the list file must match the signed manifest exactly', () => {
    const d = releaseDir(key.priv, (dir) => {
      const gz = readFileSync(join(dir, 'hayaa-list-2026110101.bin.gz'))
      gz[gz.length - 1] ^= 1
      writeFileSync(join(dir, 'hayaa-list-2026110101.bin.gz'), gz)
    })
    assert.throws(() => readPreviousDir(d, keys), /does not match the manifest/)
    assert.throws(() => readPreviousDir(releaseDir(key.priv, (dir) => rmSync(join(dir, 'hayaa-list-2026110101.bin.gz'))), keys), /is missing/)
  })

  test('build-info.json must describe the list the manifest names', () => {
    const d = releaseDir(null, (dir) => writeFileSync(join(dir, 'build-info.json'), serializeBuildInfo({ ...INFO, serial: 2026110101, hostCount: 2, hostCountHistory: [2] })))
    assert.throws(() => readPreviousDir(d, null), /does not describe the list/)
  })

  test('unsigned mode (a local dist/) checks hashes but needs no signatures', () => {
    const p = readPreviousDir(releaseDir(null), null)!
    assert.equal(p.hosts.size, 6)
    assert.match(p.origin, /unsigned local build/)
  })

  test('no folder, or an empty one: no previous release; half a release is an error', () => {
    assert.equal(readPreviousDir(join(tmp, 'missing'), keys), null)
    assert.equal(readPreviousDir(mkdtempSync(join(tmp, 'empty-')), keys), null)
    assert.throws(() => readPreviousDir(releaseDir(key.priv, (dir) => rmSync(join(dir, 'manifest.json'))), keys), /without manifest.json/)
    assert.throws(() => readPreviousDir(releaseDir(key.priv, (dir) => rmSync(join(dir, 'build-info.json'))), keys), /without build-info.json/)
  })

  test('public keys are read from keys/<id>.pub.pem only', () => {
    const d = mkdtempSync(join(tmp, 'keys-'))
    writeFileSync(join(d, 'k1.pub.pem'), key.pub)
    writeFileSync(join(d, 'README.md'), 'x')
    writeFileSync(join(d, 'k2.key.pem'), 'never')
    assert.deepEqual([...readPublicKeys(d).keys()], ['k1'])
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

/** Routes serving the release in `dir` under tag `tag`, all of `names` attached. */
const serve = (dir: string, tag = 'v2026110101', names = previousAssetNames('2026110101')): Record<string, { status: number; body?: Uint8Array | string }> => {
  const routes: Record<string, { status: number; body?: Uint8Array | string }> = {
    [LATEST]: { status: 200, body: JSON.stringify({ tag_name: tag, assets: [...names, 'starter.bin'].map(asset) }) },
  }
  for (const n of names) routes[`https://dl/${n}`] = { status: 200, body: new Uint8Array(readFileSync(join(dir, n))) }
  return routes
}

describe('fetching the previous release from GitHub', () => {
  test('HTTP 404: the repository has no release yet', async () => {
    const f = fakeFetch({ [LATEST]: { status: 404 } })
    assert.equal(await latestRelease('o/r', undefined, f), null)
    const out = join(tmp, 'none')
    assert.equal(await fetchPreviousRelease('o/r', out, undefined, f, keys), null)
    assert.deepEqual(readdirSync(out), [])
  })

  test('any other API failure throws (never mistaken for "no release")', async () => {
    for (const status of [401, 403, 500, 502]) {
      await assert.rejects(latestRelease('o/r', 't', fakeFetch({ [LATEST]: { status } })), new RegExp(`HTTP ${status}`))
    }
    await assert.rejects(latestRelease('o/r', 't', fakeFetch({ [LATEST]: { status: 200, body: '{"oops":1}' } })), /unexpected/)
  })

  test('downloads the signed files, checks every signature, and the build can read them', async () => {
    const f = fakeFetch(serve(releaseDir(key.priv)))
    const out = join(tmp, 'full')
    assert.equal(await fetchPreviousRelease('o/r', out, 'token', f, keys), 'v2026110101')
    assert.deepEqual(readdirSync(out).sort(), [...previousAssetNames('2026110101')].sort())
    assert.ok(!f.calls.includes('https://dl/starter.bin'))
    assert.equal(readPreviousDir(out, keys)!.hosts.size, 6)
  })

  test('a release missing any signed file, or signed by another key, is refused', async () => {
    const names = previousAssetNames('2026110101').filter((n) => n !== 'build-info.json.sig')
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'm1'), undefined, fakeFetch(serve(releaseDir(key.priv), 'v2026110101', names)), keys), /has no build-info.json.sig/)
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'm2'), undefined, fakeFetch(serve(releaseDir(otherKey.priv))), keys), /does not verify/)
    const forgedLock = releaseDir(key.priv, (dir) => writeFileSync(join(dir, 'sources.lock.json'), '{"lockVersion":1,"x":1}\n'))
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'm3'), undefined, fakeFetch(serve(forgedLock)), keys), /sources.lock.json.sig does not verify/)
  })

  test('a correctly signed lock from another release is refused before the re-pin can read it', async () => {
    const d = releaseDir(key.priv, (dir) => {
      const other = '{"lockVersion":1,"from":"another release"}\n'
      writeFileSync(join(dir, 'sources.lock.json'), other)
      writeFileSync(join(dir, 'sources.lock.json.sig'), signManifest(new TextEncoder().encode(other), key.priv))
    })
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'pair'), undefined, fakeFetch(serve(d)), keys), /is not the lock build-info.json names/)
  })

  test('a signed manifest of another serial attached to a newer tag is refused', async () => {
    const d = releaseDir(key.priv)
    for (const n of ['manifest.json', 'manifest.json.sig', 'hayaa-list-2026110101.bin.gz']) writeFileSync(join(d, n.replace('2026110101', '2026120101')), readFileSync(join(d, n)))
    const f = fakeFetch(serve(d, 'v2026120101', previousAssetNames('2026120101')))
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'replay'), undefined, f, keys), /names serial 2026110101/)
  })

  test('a failed asset download throws', async () => {
    const routes = serve(releaseDir(key.priv))
    routes['https://dl/manifest.json'] = { status: 503 }
    await assert.rejects(fetchPreviousRelease('o/r', join(tmp, 'fail'), undefined, fakeFetch(routes), keys), /HTTP 503/)
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
