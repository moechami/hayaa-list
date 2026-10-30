// The build itself, without I/O: source texts and hand-kept files in, release
// files and a report out. Every gate that can fail the build lives here, so
// the tests exercise exactly what the monthly job runs.
//
//   parse each source → union → add reviewed additions → drop bare public
//   suffixes → allowlist → drop hosts a listed parent already covers →
//   compile (format v2) → gates → starter list → gzip → manifest
//
// The allowlist runs BEFORE the parent dedupe: if a source lists a platform
// root and some of its subdomains, removing the root after the dedupe would
// also lose the subdomains it had absorbed.

import { createHash } from 'node:crypto'
import {
  compileHayaaList,
  decodeHayaaList,
  hayaaListMatches,
  readHayaaListHeader,
  validateHayaaList,
  type HayaaListStats,
} from './format'
import { deterministicGzip, gunzip } from './gzip'
import { listFileName, MAX_GZ_BYTES, MAX_PROBES, MAX_RAW_BYTES, serializeManifest, validateManifest, type Probe } from './manifest'
import { applyAllowlist, applyExactAllowlist, dedupeCoveredHosts, parseList, readDataLines } from './parse'
import { normalizeDomainInput } from './domains'
import { isPublicSuffix, parsePsl, registrableDomain, type PublicSuffixList } from './psl'

export type BuildInput = {
  /** Source texts in lock order. */
  sources: readonly { id: string; text: string }[]
  /** Contents of the hand-kept files in data/. */
  data: {
    allowlist: string
    additions: string
    paths: string
    reviewedTopHits: string
    starterExtra: string
    starterExclude: string
    canaries: string
    negatives: string
  }
  /** public_suffix_list.dat */
  psl: string
  /** Tranco CSV ("rank,domain" per line), most popular first. */
  tranco: string
  /** How many Tranco ranks the review gate covers. */
  trancoTop: number
  serial: number
  keyId: string
  /** Sites in the free starter list chosen by popularity (starter-extra.txt adds to them). */
  starterSize: number
}

export type BuildReport = {
  serial: number
  sources: { id: string; hosts: number; skippedLines: number; sha256: string }[]
  counts: {
    union: number
    additions: number
    publicSuffixesDropped: number
    allowlisted: number
    afterParentDedupe: number
    finalHosts: number
    paths: number
    pathsCoveredByHost: number
    pathsCoveredByPath: number
    starterHosts: number
    topSitesBlocked: number
    topSiteSubdomainEntries: number
  }
  files: Record<string, { bytes: number; sha256: string }>
  warnings: string[]
}

export type BuildOutput = {
  /** File name → bytes, everything that goes in dist/. */
  files: Map<string, Uint8Array>
  report: BuildReport
  /** The starter hosts in the order chosen (popularity first, then starter-extra.txt). */
  starter: string[]
  /** Listed subdomains of popular sites, for a human to look over (not a gate, never published). */
  topSiteSubdomainEntries: string[]
}

/** A gate failed. `details` holds extra lines for a report file (never secrets). */
export class GateError extends Error {
  constructor(
    message: string,
    readonly details: { file?: string; lines?: string[] } = {},
  ) {
    super(message)
    this.name = 'GateError'
  }
}

export const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')

/** Serial for a UTC date and a run number: 2026-11-01, run 1 → 2026110101. */
export const serialFor = (date: Date, run: number): number => {
  if (!Number.isInteger(run) || run < 1 || run > 99) throw new Error('run number must be 1..99')
  const ymd = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
  return ymd * 100 + run
}

/** "rank,domain" CSV → domains in rank order (lowercased, deduplicated). */
export const parseTranco = (csv: string): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of csv.split(/\r?\n/)) {
    const comma = line.indexOf(',')
    if (comma < 0) continue
    const domain = line.slice(comma + 1).trim().toLowerCase()
    if (domain && !seen.has(domain)) {
      seen.add(domain)
      out.push(domain)
    }
  }
  return out
}

/** A probe line: "host" or "host /path". */
const parseProbes = (text: string, what: string): Probe[] => {
  const out: Probe[] = []
  for (const line of readDataLines(text)) {
    const [hostRaw, path, extra] = line.split(/\s+/)
    if (extra !== undefined) throw new GateError(`${what}: "${line}" has more than a host and a path`)
    const host = normalizeDomainInput(hostRaw)
    if (host === null || host !== hostRaw.toLowerCase()) throw new GateError(`${what}: "${hostRaw}" is not a normalized host`)
    if (path !== undefined && !path.startsWith('/')) throw new GateError(`${what}: path "${path}" must start with "/"`)
    out.push(path === undefined ? { host } : { host, path })
  }
  if (out.length > MAX_PROBES) throw new GateError(`${what}: more than ${MAX_PROBES} entries (the app's cap)`)
  return out
}

/** Hand-kept host entries: each must already be in normalized form. */
const parseHostFile = (text: string, what: string): string[] =>
  readDataLines(text).map((line) => {
    const host = normalizeDomainInput(line)
    if (host === null || host !== line.toLowerCase()) throw new GateError(`${what}: "${line}" is not a normalized host`)
    return host
  })

type Allowlist = { exact: Set<string>; subtree: string[] }

/** "example.com" = that host itself is never an entry; "*.example.com" = nor anything under it. */
const parseAllowlist = (text: string): Allowlist => {
  const exact = new Set<string>()
  const subtree: string[] = []
  for (const line of readDataLines(text)) {
    const wild = line.startsWith('*.')
    const raw = wild ? line.slice(2) : line
    const host = normalizeDomainInput(raw)
    if (host === null || host !== raw.toLowerCase()) throw new GateError(`allowlist: "${line}" is not a normalized host`)
    if (wild) subtree.push(host)
    else exact.add(host)
  }
  return { exact, subtree }
}

const allowlisted = (a: Allowlist, host: string): boolean =>
  a.exact.has(host) || a.subtree.some((s) => host === s || host.endsWith('.' + s))

const compile = (hosts: Iterable<string>, paths: readonly string[], serial: number): { bytes: Uint8Array; stats: HayaaListStats } => {
  const out = compileHayaaList({ hosts: [...hosts], paths, serial })
  const problem = validateHayaaList(out.bytes)
  if (problem) throw new GateError(`compiled list failed validation (${problem})`)
  return out
}

/** Decode equals input: every host and every kept page entry comes back, nothing else. */
const assertRoundTrip = (bytes: Uint8Array, hosts: ReadonlySet<string>, paths: readonly string[], what: string): void => {
  const decoded = decodeHayaaList(bytes)
  const dh = new Set(decoded.hosts)
  if (dh.size !== decoded.hosts.length || dh.size !== hosts.size || [...hosts].some((h) => !dh.has(h))) {
    throw new GateError(`${what}: round trip changed the host set`)
  }
  const inputPaths = new Set(paths.map((p) => p.toLowerCase()))
  if (decoded.paths.some((p) => !inputPaths.has(p))) throw new GateError(`${what}: round trip produced a page entry that was not in the input`)
}

export const runBuild = (input: BuildInput): BuildOutput => {
  const warnings: string[] = []
  const psl: PublicSuffixList = parsePsl(input.psl)

  // 1. Sources.
  const perSource: BuildReport['sources'] = []
  const union = new Set<string>()
  for (const s of input.sources) {
    const { hosts, skipped } = parseList(s.text)
    perSource.push({ id: s.id, hosts: hosts.size, skippedLines: skipped, sha256: sha256Hex(s.text) })
    for (const h of hosts) union.add(h)
  }
  const unionCount = union.size

  // 2. Hand-kept files.
  const allow = parseAllowlist(input.data.allowlist)
  const additions = parseHostFile(input.data.additions, 'additions')
  const paths = readDataLines(input.data.paths).map((p) => p.toLowerCase())
  const reviewed = new Set(parseHostFile(input.data.reviewedTopHits, 'reviewed-top-hits'))
  const starterExtra = parseHostFile(input.data.starterExtra, 'starter-extra')
  const starterExclude = new Set(parseHostFile(input.data.starterExclude, 'starter-exclude'))
  const canaries = parseProbes(input.data.canaries, 'canaries')
  const negatives = parseProbes(input.data.negatives, 'negatives')
  if (canaries.length === 0) throw new GateError('canaries: at least one is required')

  for (const h of additions) {
    if (isPublicSuffix(psl, h)) throw new GateError(`additions: "${h}" is a public suffix`)
    if (allowlisted(allow, h)) throw new GateError(`additions: "${h}" is also on the allowlist`)
    union.add(h)
  }
  for (const p of paths) {
    const host = p.split('/', 1)[0]
    if (isPublicSuffix(psl, host)) throw new GateError(`paths: the host of "${p}" is a public suffix`)
    if (allow.subtree.some((s) => host === s || host.endsWith('.' + s))) throw new GateError(`paths: "${p}" is under an allowlisted domain`)
  }
  for (const h of reviewed) if (allowlisted(allow, h)) warnings.push(`reviewed-top-hits: "${h}" is also allowlisted, so it is not blocked`)

  // 3. Public Suffix guard: a bare suffix would block every site registered under it.
  let publicSuffixesDropped = 0
  for (const h of [...union]) {
    if (isPublicSuffix(psl, h)) {
      union.delete(h)
      publicSuffixesDropped++
    }
  }

  // 4. Allowlist (before the dedupe, see the top of this file).
  const afterSubtree = applyAllowlist(union, allow.subtree)
  const afterExact = applyExactAllowlist(afterSubtree.hosts, allow.exact)
  const allowlistedCount = afterSubtree.removed + afterExact.removed

  // 5. Parent dedupe.
  const finalHosts = dedupeCoveredHosts(afterExact.hosts)

  // 6. Compile and check the full list.
  const full = compile(finalHosts, paths, input.serial)
  assertRoundTrip(full.bytes, finalHosts, paths, 'full list')
  const header = readHayaaListHeader(full.bytes)
  if (!header || header.version !== 2 || header.serial !== input.serial || header.hostCount !== finalHosts.size) {
    throw new GateError('full list header does not match the build')
  }
  if (full.bytes.length > MAX_RAW_BYTES) throw new GateError('full list is over the app\'s 96 MiB cap')
  for (const h of finalHosts) if (isPublicSuffix(psl, h)) throw new GateError(`"${h}" is a public suffix`) // invariant

  // 7. Canaries and negatives, through the same matching rule the app uses.
  for (const c of canaries) {
    if (!hayaaListMatches(full.bytes, c.host, c.path ?? null)) throw new GateError(`canary does not match: ${c.host}${c.path ?? ''}`)
  }
  for (const n of negatives) {
    if (hayaaListMatches(full.bytes, n.host, n.path ?? null)) throw new GateError(`negative matches: ${n.host}${n.path ?? ''}`)
  }

  // 8. Top-sites review: every popular site the list blocks must have been reviewed by hand.
  const ranked = parseTranco(input.tranco).slice(0, input.trancoTop)
  if (ranked.length < input.trancoTop) throw new GateError(`top-sites list has ${ranked.length} entries, expected ${input.trancoTop}`)
  const topHits = ranked.filter((d) => hayaaListMatches(full.bytes, d))
  const unreviewed = topHits.filter((d) => !reviewed.has(d))
  if (unreviewed.length > 0) {
    throw new GateError(
      `${unreviewed.length} top site(s) would be blocked without review; see dist/top-hits-candidates.txt. ` +
        'Add each genuinely adult site to data/reviewed-top-hits.txt and each wrong one to data/allowlist.txt.',
      { file: 'top-hits-candidates.txt', lines: [...unreviewed].sort() },
    )
  }
  const topSet = new Set(ranked)
  for (const h of reviewed) if (!topSet.has(h)) warnings.push(`reviewed-top-hits: "${h}" is no longer in the top ${input.trancoTop}`)
  // Listed subdomains of popular sites (not gated: the site itself stays reachable).
  const subEntries = [...finalHosts].filter((h) => {
    const reg = registrableDomain(psl, h)
    return reg !== null && reg !== h && topSet.has(reg) && !reviewed.has(reg)
  })

  // 9. Starter list: the most popular listed sites, registrable domains only.
  const starter: string[] = []
  for (const d of ranked) {
    if (starter.length >= input.starterSize) break
    if (finalHosts.has(d) && !starterExclude.has(d) && registrableDomain(psl, d) === d) starter.push(d)
  }
  if (starter.length < input.starterSize) warnings.push(`starter list has only ${starter.length} popular sites`)
  for (const h of starterExtra) {
    if (!finalHosts.has(h)) throw new GateError(`starter-extra: "${h}" is not an entry of the full list`)
    if (starterExclude.has(h)) throw new GateError(`starter-extra: "${h}" is also in starter-exclude`)
    if (!starter.includes(h)) starter.push(h)
  }
  const starterSet = new Set(starter)
  if (starterSet.size >= finalHosts.size || [...starterSet].some((h) => !finalHosts.has(h))) {
    throw new GateError('starter list is not a strict subset of the full list')
  }
  const starterList = compile(starterSet, [], input.serial)
  assertRoundTrip(starterList.bytes, starterSet, [], 'starter list')

  // 10. Gzip, checked by an independent inflater.
  const gz = deterministicGzip(full.bytes)
  if (gz.length > MAX_GZ_BYTES) throw new GateError('compressed list is over the app\'s 40 MiB cap')
  if (sha256Hex(gunzip(gz)) !== sha256Hex(full.bytes)) throw new GateError('gzip round trip failed')

  // 11. Manifest.
  const gzName = listFileName(input.serial)
  const manifest = serializeManifest({
    format: 2,
    serial: input.serial,
    keyId: input.keyId,
    file: { name: gzName, size: full.bytes.length, sha256: sha256Hex(full.bytes), gzSize: gz.length, gzSha256: sha256Hex(gz) },
    hostCount: header.hostCount,
    canaries,
    negatives,
  })
  const manifestProblem = validateManifest(manifest)
  if (manifestProblem) throw new GateError(`manifest refused (${manifestProblem})`)

  // Plain-text form of the list: hosts, then page entries, each sorted.
  const text =
    [...finalHosts].sort().join('\n') + '\n' + (full.stats.paths > 0 ? decodeHayaaList(full.bytes).paths.sort().join('\n') + '\n' : '')

  const files = new Map<string, Uint8Array>([
    [`hayaa-list-${input.serial}.bin`, full.bytes],
    [gzName, gz],
    [`hayaa-list-${input.serial}.txt`, new TextEncoder().encode(text)],
    ['starter.bin', starterList.bytes],
    ['manifest.json', manifest],
  ])
  const fileReport: BuildReport['files'] = {}
  for (const [name, bytes] of files) fileReport[name] = { bytes: bytes.length, sha256: sha256Hex(bytes) }

  return {
    files,
    starter,
    topSiteSubdomainEntries: subEntries.sort(),
    report: {
      serial: input.serial,
      sources: perSource,
      counts: {
        union: unionCount,
        additions: additions.length,
        publicSuffixesDropped,
        allowlisted: allowlistedCount,
        afterParentDedupe: finalHosts.size,
        finalHosts: header.hostCount,
        paths: full.stats.paths,
        pathsCoveredByHost: full.stats.pathsCoveredByHost,
        pathsCoveredByPath: full.stats.pathsCoveredByPath,
        starterHosts: starterSet.size,
        topSitesBlocked: topHits.length,
        topSiteSubdomainEntries: subEntries.length,
      },
      files: fileReport,
      warnings,
    },
  }
}
