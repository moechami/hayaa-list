// SPDX-License-Identifier: GPL-3.0-or-later
//
// The previous release, which the monthly build compares itself against.
//
// Everything is taken from SIGNED files only:
//   - manifest.json (+ .sig): names the list file, its sizes and hashes;
//   - hayaa-list-<serial>.bin.gz: the list itself, checked against the
//     manifest and fully validated, then decoded for the previous host set;
//   - build-info.json (+ .sig): per-source counts, the host-count history,
//     the entries held back for review, the gate overrides used, and the
//     SHA-256 of the sources.lock.json the release was built from;
//   - sources.lock.json (+ .sig): must be exactly the lock build-info.json
//     names, so a lock from one release can never be paired with another.
// The plain-text list attached to a release is a convenience for people and
// is never read: it is not signed.
//
// In CI the release comes from GitHub (fetchPreviousRelease) and every
// signature must verify against a key in keys/; a repository with no release
// yet gives an empty folder, and any other API answer fails the job instead
// of being mistaken for "no release". Locally the previous release is an
// earlier build in dist/ (unsigned, so only the hashes are checked), or
// nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeHayaaList, readHayaaListHeader, validateHayaaList } from './format'
import { gunzip } from './gzip'
import { validateManifest, type Manifest } from './manifest'
import { sha256Hex } from './hash'
import { verifySignature } from './signing'

export const BUILD_INFO = 'build-info.json'
export const BUILD_INFO_VERSION = 3
export const LOCK_FILE = 'sources.lock.json'

export type SourceInfo = { id: string; commit: string | null; sha256: string; lines: number; hosts: number; skippedLines: number }

/** build-info.json: what the next build needs to know about this one. Deterministic. */
export type BuildInfo = {
  buildInfoVersion: number
  serial: number
  hostCount: number
  pathCount: number
  /** Host counts of the latest releases, oldest first, this one last (config.ts SHRINK_HISTORY). */
  hostCountHistory: number[]
  sources: SourceInfo[]
  /** Entries left out of this release until a person reviews them. */
  heldBack: { topSites: string[]; topSiteSubdomains: string[] }
  /** Education and government hosts left out until reviewed (src/edugov.ts). */
  heldBackEduGov: string[]
  /** Whether config.ts BLP_STRICT was on, and how many hosts it held back. */
  blpStrict: boolean
  heldBackBlpStrict: number
  /** The gate overrides this release was built with (workflow inputs allow_shrink, allow_growth). */
  gateOverrides: { allowShrink: boolean; allowGrowth: boolean }
  /** SHA-256 of the sources.lock.json this release was built from (attached to the release, signed). */
  sourcesLockSha256: string
}

export type PreviousRelease = {
  /** Host entries of the previous list (page entries are not needed). */
  hosts: ReadonlySet<string>
  info: BuildInfo
  /** Where it came from, for the log. */
  origin: string
}

export const serializeBuildInfo = (info: BuildInfo): Uint8Array => {
  const ordered: BuildInfo = {
    buildInfoVersion: info.buildInfoVersion,
    serial: info.serial,
    hostCount: info.hostCount,
    pathCount: info.pathCount,
    hostCountHistory: [...info.hostCountHistory],
    sources: info.sources.map((s) => ({ id: s.id, commit: s.commit, sha256: s.sha256, lines: s.lines, hosts: s.hosts, skippedLines: s.skippedLines })),
    heldBack: { topSites: [...info.heldBack.topSites], topSiteSubdomains: [...info.heldBack.topSiteSubdomains] },
    heldBackEduGov: [...info.heldBackEduGov],
    blpStrict: info.blpStrict,
    heldBackBlpStrict: info.heldBackBlpStrict,
    gateOverrides: { allowShrink: info.gateOverrides.allowShrink, allowGrowth: info.gateOverrides.allowGrowth },
    sourcesLockSha256: info.sourcesLockSha256,
  }
  return new TextEncoder().encode(JSON.stringify(ordered, null, 2) + '\n')
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/**
 * Parse and check build-info.json; throws on anything malformed (a damaged
 * file must not weaken a gate). The manifest and the lock are signed by the
 * same key, so a file carrying their version fields ("format",
 * "lockVersion") is refused even before its own version is checked.
 */
export const parseBuildInfo = (text: string): BuildInfo => {
  const o: unknown = JSON.parse(text)
  if (isObj(o) && ('format' in o || 'lockVersion' in o)) throw new Error('build-info.json: not a build-info file (it carries the field of another signed file)')
  if (!isObj(o) || o.buildInfoVersion !== BUILD_INFO_VERSION) throw new Error('build-info.json: unknown buildInfoVersion')
  if (!isCount(o.serial) || !isCount(o.hostCount) || !isCount(o.pathCount)) throw new Error('build-info.json: bad counts')
  const history = o.hostCountHistory
  if (!Array.isArray(history) || history.length === 0 || !history.every(isCount) || history[history.length - 1] !== o.hostCount) {
    throw new Error('build-info.json: bad hostCountHistory')
  }
  if (!Array.isArray(o.sources)) throw new Error('build-info.json: sources missing')
  const sources: SourceInfo[] = o.sources.map((s: unknown) => {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.sha256 !== 'string') throw new Error('build-info.json: bad source')
    if (!isCount(s.lines) || !isCount(s.hosts) || !isCount(s.skippedLines)) throw new Error(`build-info.json: bad counts for ${s.id}`)
    if (s.commit !== null && typeof s.commit !== 'string') throw new Error(`build-info.json: bad commit for ${s.id}`)
    return { id: s.id, commit: s.commit, sha256: s.sha256, lines: s.lines, hosts: s.hosts, skippedLines: s.skippedLines }
  })
  const h = o.heldBack
  if (!isObj(h) || !isStrings(h.topSites) || !isStrings(h.topSiteSubdomains)) throw new Error('build-info.json: bad heldBack')
  if (!isStrings(o.heldBackEduGov)) throw new Error('build-info.json: bad heldBackEduGov')
  if (typeof o.blpStrict !== 'boolean' || !isCount(o.heldBackBlpStrict)) throw new Error('build-info.json: bad blpStrict')
  const g = o.gateOverrides
  if (!isObj(g) || typeof g.allowShrink !== 'boolean' || typeof g.allowGrowth !== 'boolean') throw new Error('build-info.json: bad gateOverrides')
  if (typeof o.sourcesLockSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sourcesLockSha256)) throw new Error('build-info.json: bad sourcesLockSha256')
  return {
    buildInfoVersion: BUILD_INFO_VERSION,
    serial: o.serial,
    hostCount: o.hostCount,
    pathCount: o.pathCount,
    hostCountHistory: history as number[],
    sources,
    heldBack: { topSites: h.topSites, topSiteSubdomains: h.topSiteSubdomains },
    heldBackEduGov: o.heldBackEduGov,
    blpStrict: o.blpStrict,
    heldBackBlpStrict: o.heldBackBlpStrict,
    gateOverrides: { allowShrink: g.allowShrink, allowGrowth: g.allowGrowth },
    sourcesLockSha256: o.sourcesLockSha256,
  }
}

/**
 * Throws unless `<dir>/sources.lock.json` is the lock that the build-info.json
 * of the same folder names (its SHA-256). Both files are signed, but
 * separately: without this check a lock from one release could be attached
 * to another and steer the next re-pin's fallback.
 */
export const assertLockPairing = (dir: string, info: BuildInfo): void => {
  const lockPath = join(dir, LOCK_FILE)
  if (!existsSync(lockPath)) throw new Error(`${dir}: ${LOCK_FILE} is missing`)
  const got = sha256Hex(new Uint8Array(readFileSync(lockPath)))
  if (got !== info.sourcesLockSha256) throw new Error(`${dir}: ${LOCK_FILE} is not the lock ${BUILD_INFO} names (sha256 ${got}, expected ${info.sourcesLockSha256})`)
}

/** Every public key in `keysDir` (files named <keyId>.pub.pem), keyed by key id. */
export const readPublicKeys = (keysDir: string): Map<string, string> => {
  const out = new Map<string, string>()
  if (!existsSync(keysDir)) return out
  for (const name of readdirSync(keysDir).sort()) {
    const m = /^([A-Za-z0-9_-]{1,32})\.pub\.pem$/.exec(name)
    if (m) out.set(m[1], readFileSync(join(keysDir, name), 'utf8'))
  }
  return out
}

/** True when `sig` verifies `data` under one of `keys`. */
const signedByOneOf = (data: Uint8Array, sig: Uint8Array, keys: ReadonlyMap<string, string>): boolean =>
  [...keys.values()].some((pem) => verifySignature(data, sig, pem))

/**
 * Check `<dir>/<name>.sig` against `keys`; throws when it is missing or does
 * not verify. Used for every signed file of a downloaded release.
 */
export const assertSigned = (dir: string, name: string, keys: ReadonlyMap<string, string>): void => {
  if (keys.size === 0) throw new Error('no public keys in keys/: a signed previous release cannot be checked')
  const sigPath = join(dir, `${name}.sig`)
  if (!existsSync(sigPath)) throw new Error(`${dir}: ${name}.sig is missing`)
  const data = new Uint8Array(readFileSync(join(dir, name)))
  if (!signedByOneOf(data, new Uint8Array(readFileSync(sigPath)), keys)) throw new Error(`${dir}: ${name}.sig does not verify with any key in keys/`)
}

/**
 * The previous release in `dir`, or null when there is none (no folder, or
 * an empty one). With `keys`, manifest.json and build-info.json must carry
 * signatures that verify with one of them; with null (a local build in
 * dist/), signatures are not required. Either way the list file must match
 * the manifest exactly and pass full validation, and build-info.json must
 * describe the same list. The host set is decoded from the list file.
 */
export const readPreviousDir = (dir: string, keys: ReadonlyMap<string, string> | null): PreviousRelease | null => {
  if (!existsSync(dir)) return null
  const manifestPath = join(dir, 'manifest.json')
  const infoPath = join(dir, BUILD_INFO)
  if (!existsSync(manifestPath)) {
    if (existsSync(infoPath)) throw new Error(`${dir}: ${BUILD_INFO} without manifest.json`)
    return null
  }
  if (!existsSync(infoPath)) throw new Error(`${dir}: manifest.json without ${BUILD_INFO}`)
  if (keys !== null) {
    assertSigned(dir, 'manifest.json', keys)
    assertSigned(dir, BUILD_INFO, keys)
    if (!existsSync(join(dir, LOCK_FILE))) throw new Error(`${dir}: ${LOCK_FILE} is missing`)
    assertSigned(dir, LOCK_FILE, keys)
  }
  const manifestBytes = new Uint8Array(readFileSync(manifestPath))
  const problem = validateManifest(manifestBytes)
  if (problem) throw new Error(`${dir}: manifest.json refused (${problem})`)
  const m = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest
  const gzPath = join(dir, m.file.name)
  if (!existsSync(gzPath)) throw new Error(`${dir}: ${m.file.name} is missing`)
  const gz = new Uint8Array(readFileSync(gzPath))
  if (gz.length !== m.file.gzSize || sha256Hex(gz) !== m.file.gzSha256) throw new Error(`${dir}: ${m.file.name} does not match the manifest`)
  const raw = gunzip(gz)
  if (raw.length !== m.file.size || sha256Hex(raw) !== m.file.sha256) throw new Error(`${dir}: inflated list does not match the manifest`)
  const header = readHayaaListHeader(raw)
  if (!header || header.serial !== m.serial || header.hostCount !== m.hostCount) throw new Error(`${dir}: list header does not match the manifest`)
  const invalid = validateHayaaList(raw)
  if (invalid) throw new Error(`${dir}: list failed validation (${invalid})`)
  const decoded = decodeHayaaList(raw)
  const info = parseBuildInfo(readFileSync(infoPath, 'utf8'))
  if (info.serial !== m.serial || info.hostCount !== m.hostCount || info.pathCount !== decoded.paths.length) {
    throw new Error(`${dir}: ${BUILD_INFO} does not describe the list the manifest names`)
  }
  // A signed release must carry its own lock; a local dist/ has none, but a lock that is there must match.
  if (keys !== null || existsSync(join(dir, LOCK_FILE))) assertLockPairing(dir, info)
  return { hosts: new Set(decoded.hosts), info, origin: `${dir} (serial ${m.serial}${keys ? ', signatures verified' : ', unsigned local build'})` }
}

// ---------------------------------------------------------------------------
// GitHub releases

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>

const apiHeaders = (token: string | undefined): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'hayaa-list-build',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})

type ReleaseJson = { tag_name?: unknown; draft?: unknown; assets?: unknown }
export type ReleaseAsset = { name: string; url: string }

/**
 * The repository's latest release, or null when it has none (HTTP 404).
 * Every other failure throws: an API error must never read as "no release",
 * or the gates that compare against the previous release would be skipped.
 */
export const latestRelease = async (repo: string, token: string | undefined, f: FetchLike): Promise<{ tag: string; assets: ReleaseAsset[] } | null> => {
  const res = await f(`https://api.github.com/repos/${repo}/releases/latest`, { headers: apiHeaders(token) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status} for the latest release of ${repo}`)
  const body = JSON.parse(await res.text()) as ReleaseJson
  if (typeof body.tag_name !== 'string' || !Array.isArray(body.assets)) throw new Error('GitHub API: unexpected latest-release answer')
  const assets = (body.assets as { name?: unknown; browser_download_url?: unknown }[]).map((a) => {
    if (typeof a.name !== 'string' || typeof a.browser_download_url !== 'string') throw new Error('GitHub API: unexpected asset')
    return { name: a.name, url: a.browser_download_url }
  })
  return { tag: body.tag_name, assets }
}

/**
 * Every release serial (tags v<YYYYMMDDNN>), drafts included. An empty array
 * means the repository has no release; any API error throws.
 */
export const releaseSerials = async (repo: string, token: string | undefined, f: FetchLike): Promise<number[]> => {
  const out: number[] = []
  for (let page = 1; page <= 100; page++) {
    const res = await f(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers: apiHeaders(token) })
    if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status} listing the releases of ${repo}`)
    const body = JSON.parse(await res.text()) as unknown
    if (!Array.isArray(body)) throw new Error('GitHub API: unexpected release list')
    for (const r of body as ReleaseJson[]) {
      const m = typeof r.tag_name === 'string' ? /^v([0-9]{10})$/.exec(r.tag_name) : null
      if (m) out.push(Number(m[1]))
    }
    if (body.length < 100) return out
  }
  throw new Error('GitHub API: too many release pages')
}

/** The files of a release that the next build reads, every one required. */
export const previousAssetNames = (serial: string): string[] => [
  'manifest.json',
  'manifest.json.sig',
  `hayaa-list-${serial}.bin.gz`,
  BUILD_INFO,
  `${BUILD_INFO}.sig`,
  'sources.lock.json',
  'sources.lock.json.sig',
]

/**
 * Download the latest release's signed files into `outDir` (created, possibly
 * left empty) and check every signature against `keys` before anything is
 * used. Returns the tag, or null when the repository has no release yet. A
 * release missing any of the files, or with a signature that does not
 * verify, or whose manifest names another serial than its tag, is refused.
 */
export const fetchPreviousRelease = async (
  repo: string,
  outDir: string,
  token: string | undefined,
  f: FetchLike,
  keys: ReadonlyMap<string, string>,
): Promise<string | null> => {
  mkdirSync(outDir, { recursive: true })
  const latest = await latestRelease(repo, token, f)
  if (latest === null) return null
  const m = /^v([0-9]{10})$/.exec(latest.tag)
  if (!m) throw new Error(`latest release tag ${latest.tag} is not v<serial>`)
  for (const name of previousAssetNames(m[1])) {
    const asset = latest.assets.find((a) => a.name === name)
    if (!asset) throw new Error(`release ${latest.tag} has no ${name}`)
    const res = await f(asset.url, { headers: { 'user-agent': 'hayaa-list-build' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${name} from ${latest.tag}`)
    writeFileSync(join(outDir, name), new Uint8Array(await res.arrayBuffer()))
  }
  for (const name of ['manifest.json', BUILD_INFO, LOCK_FILE]) assertSigned(outDir, name, keys)
  // The re-pin reads this lock before the build reads the rest: check that it belongs to this release now.
  assertLockPairing(outDir, parseBuildInfo(readFileSync(join(outDir, BUILD_INFO), 'utf8')))
  const serial = (JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as { serial?: unknown }).serial
  if (serial !== Number(m[1])) throw new Error(`release ${latest.tag}: its signed manifest names serial ${String(serial)}`)
  return latest.tag
}
