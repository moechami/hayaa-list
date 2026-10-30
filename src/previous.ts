// The previous release, which the monthly build compares itself against:
//
//   - build-info.json: per-source host counts and the entries held back for
//     review (written by every build, attached to every release);
//   - hayaa-list-<serial>.txt: the hosts the previous release listed.
//
// In CI they come from the latest GitHub release (fetchPreviousRelease); a
// repository with no release yet gives an empty folder, and any other API
// answer fails the job instead of being mistaken for "no release". Locally
// they come from an earlier build in dist/, or nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BUILD_INFO = 'build-info.json'
export const BUILD_INFO_VERSION = 1

export type SourceInfo = { id: string; commit: string | null; sha256: string; lines: number; hosts: number; skippedLines: number }

/** build-info.json: what the next build needs to know about this one. Deterministic. */
export type BuildInfo = {
  buildInfoVersion: number
  serial: number
  hostCount: number
  pathCount: number
  sources: SourceInfo[]
  /** Entries left out of this release until a person reviews them. */
  heldBack: { topSites: string[]; topSiteSubdomains: string[] }
}

export type PreviousRelease = {
  /** Host entries of the previous list (page entries are not needed). */
  hosts: ReadonlySet<string>
  /** Null for a release made before build-info.json existed. */
  info: BuildInfo | null
  /** Where it came from, for the log. */
  origin: string
}

export const serializeBuildInfo = (info: BuildInfo): Uint8Array => {
  const ordered: BuildInfo = {
    buildInfoVersion: info.buildInfoVersion,
    serial: info.serial,
    hostCount: info.hostCount,
    pathCount: info.pathCount,
    sources: info.sources.map((s) => ({ id: s.id, commit: s.commit, sha256: s.sha256, lines: s.lines, hosts: s.hosts, skippedLines: s.skippedLines })),
    heldBack: { topSites: [...info.heldBack.topSites], topSiteSubdomains: [...info.heldBack.topSiteSubdomains] },
  }
  return new TextEncoder().encode(JSON.stringify(ordered, null, 2) + '\n')
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Parse and check build-info.json; throws on anything malformed (a damaged file must not weaken a gate). */
export const parseBuildInfo = (text: string): BuildInfo => {
  const o: unknown = JSON.parse(text)
  if (!isObj(o) || o.buildInfoVersion !== BUILD_INFO_VERSION) throw new Error('build-info.json: unknown buildInfoVersion')
  if (!isCount(o.serial) || !isCount(o.hostCount) || !isCount(o.pathCount)) throw new Error('build-info.json: bad counts')
  if (!Array.isArray(o.sources)) throw new Error('build-info.json: sources missing')
  const sources: SourceInfo[] = o.sources.map((s: unknown) => {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.sha256 !== 'string') throw new Error('build-info.json: bad source')
    if (!isCount(s.lines) || !isCount(s.hosts) || !isCount(s.skippedLines)) throw new Error(`build-info.json: bad counts for ${s.id}`)
    if (s.commit !== null && typeof s.commit !== 'string') throw new Error(`build-info.json: bad commit for ${s.id}`)
    return { id: s.id, commit: s.commit, sha256: s.sha256, lines: s.lines, hosts: s.hosts, skippedLines: s.skippedLines }
  })
  const h = o.heldBack
  if (!isObj(h) || !isStrings(h.topSites) || !isStrings(h.topSiteSubdomains)) throw new Error('build-info.json: bad heldBack')
  return { buildInfoVersion: BUILD_INFO_VERSION, serial: o.serial, hostCount: o.hostCount, pathCount: o.pathCount, sources, heldBack: { topSites: h.topSites, topSiteSubdomains: h.topSiteSubdomains } }
}

/** Host entries of a plain-text list (page entries, which contain "/", are skipped). */
export const parseListText = (text: string): Set<string> => {
  const out = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim()
    if (entry !== '' && !entry.includes('/')) out.add(entry)
  }
  return out
}

const LIST_TXT = /^hayaa-list-([0-9]{10})\.txt$/

/**
 * The previous release in `dir`, or null when there is none (no folder, or
 * no list in it). With build-info.json the list must be the one it names;
 * without it (a release older than build-info.json) the newest list there is
 * used and the count gates are skipped.
 */
export const readPreviousDir = (dir: string): PreviousRelease | null => {
  if (!existsSync(dir)) return null
  const infoPath = join(dir, BUILD_INFO)
  if (existsSync(infoPath)) {
    const info = parseBuildInfo(readFileSync(infoPath, 'utf8'))
    const txt = join(dir, `hayaa-list-${info.serial}.txt`)
    if (!existsSync(txt)) throw new Error(`${dir}: ${BUILD_INFO} names serial ${info.serial} but hayaa-list-${info.serial}.txt is missing`)
    return { hosts: parseListText(readFileSync(txt, 'utf8')), info, origin: `${dir} (serial ${info.serial})` }
  }
  const lists = readdirSync(dir)
    .filter((n) => LIST_TXT.test(n))
    .sort()
  if (lists.length === 0) return null
  const newest = lists[lists.length - 1]
  return { hosts: parseListText(readFileSync(join(dir, newest), 'utf8')), info: null, origin: `${dir}/${newest} (no ${BUILD_INFO})` }
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

/**
 * Download the latest release's list, build-info.json and sources.lock.json
 * into `outDir` (created, possibly left empty). Returns the tag, or null when
 * the repository has no release yet. A release without its plain-text list
 * is refused: comparing against an empty list would hold back nothing that
 * was listed before and re-review everything.
 */
export const fetchPreviousRelease = async (repo: string, outDir: string, token: string | undefined, f: FetchLike): Promise<string | null> => {
  mkdirSync(outDir, { recursive: true })
  const latest = await latestRelease(repo, token, f)
  if (latest === null) return null
  const m = /^v([0-9]{10})$/.exec(latest.tag)
  if (!m) throw new Error(`latest release tag ${latest.tag} is not v<serial>`)
  const want = [`hayaa-list-${m[1]}.txt`, BUILD_INFO, 'sources.lock.json']
  for (const name of want) {
    const asset = latest.assets.find((a) => a.name === name)
    if (!asset) {
      if (name === want[0]) throw new Error(`release ${latest.tag} has no ${name}`)
      continue // older releases have no build-info.json
    }
    const res = await f(asset.url, { headers: { 'user-agent': 'hayaa-list-build' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${name} from ${latest.tag}`)
    writeFileSync(join(outDir, name), new Uint8Array(await res.arrayBuffer()))
  }
  return latest.tag
}
