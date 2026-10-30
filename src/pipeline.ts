// SPDX-License-Identifier: GPL-3.0-or-later
//
// The build itself, without I/O: source texts, hand-kept files and the
// previous release in; release files and a report out. Every gate that can
// fail the build lives here, so the tests exercise exactly what the monthly
// job runs.
//
//   parse each source (format gate) → union → add reviewed additions → drop
//   bare public suffixes → protected-name gate → false keyword matches →
//   allowlist → review gates on popular sites (hold back new unreviewed
//   entries) → drop hosts a listed parent already covers → shrink and growth
//   gates → compile (format v2) → canaries and negatives → starter list →
//   gzip → manifest and build-info.json
//
// The allowlist runs BEFORE the parent dedupe: if a source lists a platform
// root and some of its subdomains, removing the root after the dedupe would
// also lose the subdomains it had absorbed.
//
// Review gates. Two kinds of entries need a person's review before they are
// published: a site in the Tranco top 10,000 (data/reviewed-top-hits.txt),
// and a listed subdomain of a site in the top 10,000
// (data/reviewed-top-site-subdomains.txt). An unreviewed one that the
// previous release already listed stays listed; a new one is held back (left
// out of this release, listed in build-info.json and in an issue) until it is
// reviewed. More than MAX_NEW_HELD_BACK new ones at once fails the build;
// entries in data/pending-review.txt (looked at, left undecided) stay held
// back without counting as new.

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
import { applyAllowlist, applyExactAllowlist, coveredBy, dedupeCoveredHosts, parentDomains, parseList, readDataLines } from './parse'
import { normalizeDomainInput } from './domains'
import { isPublicSuffix, parsePsl, registrableDomain, type PublicSuffixList } from './psl'
import { BUILD_INFO, BUILD_INFO_VERSION, serializeBuildInfo, type BuildInfo, type PreviousRelease, type SourceInfo } from './previous'
import { MAX_SKIPPED_RATIO, MIN_SKIPPED_LINES, MIN_SOURCE_RATIO, MIN_TOTAL_RATIO } from './config'
import { sha256Hex } from './hash'
import { isKeywordFalseMatch, parseKeywordRules, parseProtectedTerms, parseReasonedHosts, protectedTermsOf } from './protected'

export { sha256Hex }

export type BuildInput = {
  /** Source texts in lock order, with the commit each was read at. */
  sources: readonly { id: string; text: string; commit?: string }[]
  /** Contents of the hand-kept files in data/. */
  data: {
    allowlist: string
    additions: string
    paths: string
    reviewedTopHits: string
    reviewedTopSiteSubdomains: string
    starterExtra: string
    starterExclude: string
    starterBrands: string
    canaries: string
    negatives: string
    /** data/protected-terms.txt and data/reviewed-protected.txt (the protected-name gate). */
    protectedTerms: string
    reviewedProtected: string
    /** data/keyword-false-matches.txt, for hosts only a keyword-matched source lists. */
    keywordFalseMatches: string
    /** data/pending-review.txt: popular entries a person looked at and left undecided. */
    pendingReview: string
  }
  /** public_suffix_list.dat */
  psl: string
  /** Tranco CSV ("rank,domain" per line), most popular first. */
  tranco: string
  /** How many Tranco ranks the top-sites review gate covers. */
  trancoTop: number
  /** How many Tranco ranks the subdomain review gate covers. */
  subdomainRanks: number
  serial: number
  keyId: string
  /** Total size of the free starter list (popular picks plus starter-extra.txt). */
  starterSize: number
  /** How many starter entries one brand may take. */
  starterPerBrand: number
  /** The previous release, or null when there is none. */
  previous: PreviousRelease | null
  /** New held-back entries above this fail the build. */
  maxNewHeldBack: number
  /** Skip the shrink gates (a deliberate, reviewed removal of a source). */
  allowShrink: boolean
  /** Skip the growth gates (growth a person has checked). */
  allowGrowth: boolean
  /** Sources built partly by keyword matching (config.ts KEYWORD_MATCHED_SOURCES). */
  keywordMatchedSources: readonly string[]
  /** Slow-shrink guard: releases of host-count history, and the absolute floor. */
  shrinkHistory: number
  hostFloor: number
  /** Growth gates (config.ts). */
  maxTotalGrowth: number
  maxSourceGrowth: number
  maxNewRegistrableDomains: number
}

export type BuildReport = {
  serial: number
  previous: string | null
  sources: SourceInfo[]
  counts: {
    union: number
    additions: number
    publicSuffixesDropped: number
    protectedNamesRemoved: number
    keywordFalseMatchesRemoved: number
    allowlisted: number
    finalHosts: number
    paths: number
    pathsCoveredByHost: number
    pathsCoveredByPath: number
    starterHosts: number
    topSitesBlocked: number
    unreviewedKeptFromPrevious: number
    heldBackTopSites: number
    heldBackTopSiteSubdomains: number
    newHeldBack: number
    topSiteSubdomainEntries: number
  }
  /** Per source: registrable domains it lists that the previous release did not (null without a previous release). */
  newRegistrableDomains: Record<string, number> | null
  files: Record<string, { bytes: number; sha256: string }>
  warnings: string[]
}

export type BuildOutput = {
  /** File name → bytes, everything that goes in dist/ and the release. */
  files: Map<string, Uint8Array>
  report: BuildReport
  /** The starter hosts in the order chosen (popularity first, then starter-extra.txt). */
  starter: string[]
  /** Entries left out of this release until reviewed. */
  heldBack: { topSites: string[]; topSiteSubdomains: string[] }
  /** Held-back entries that are neither in data/pending-review.txt nor held back by the previous release. */
  newHeldBack: string[]
  /** Unreviewed entries kept only because the previous release listed them. */
  keptFromPrevious: string[]
  /** Listed subdomains of the top-10,000 sites, a review aid (never published). */
  topSiteSubdomainEntries: string[]
  /** Review aids (never published): what the two name rules removed. */
  removedProtected: { host: string; terms: string[] }[]
  removedKeywordFalseMatches: string[]
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

/** The header serial of starter.bin: never a release serial (FORMAT.md). */
export const STARTER_SERIAL = 0

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

/** "example.com" = that host exactly; "*.example.com" = that host and everything under it. */
type HostRules = { exact: Set<string>; subtree: string[] }

const parseHostRules = (text: string, what: string): HostRules => {
  const exact = new Set<string>()
  const subtree: string[] = []
  for (const line of readDataLines(text)) {
    const wild = line.startsWith('*.')
    const raw = wild ? line.slice(2) : line
    const host = normalizeDomainInput(raw)
    if (host === null || host !== raw.toLowerCase()) throw new GateError(`${what}: "${line}" is not a normalized host`)
    if (wild) subtree.push(host)
    else exact.add(host)
  }
  return { exact, subtree }
}

const underSubtree = (r: HostRules, host: string): boolean => r.subtree.some((s) => host === s || host.endsWith('.' + s))
const ruleCovers = (r: HostRules, host: string): boolean => r.exact.has(host) || underSubtree(r, host)

/**
 * The brand of a registrable domain, for the starter list's per-brand cap:
 * its name label without trailing digits or a hyphenated tail
 * ("xhamster2.com" and "xhamster.desi" → "xhamster", "xnxx-tv.com" → "xnxx").
 */
export const brandKey = (registrable: string): string => {
  const label = registrable.split('.', 1)[0]
  const noDigits = label.replace(/[0-9]+$/, '')
  const base = noDigits.length >= 3 ? noDigits : label // "e621" stays "e621"
  const head = base.split('-', 1)[0]
  return head.length >= 4 ? head : base // "e-hentai" stays "e-hentai"
}

/** data/starter-brands.txt: "<registrable domain> <brand>" per line. */
const parseBrands = (text: string): Map<string, string> => {
  const out = new Map<string, string>()
  for (const line of readDataLines(text)) {
    const [domain, brand, extra] = line.split(/\s+/)
    if (brand === undefined || extra !== undefined) throw new GateError(`starter-brands: "${line}" must be a domain and a brand`)
    if (normalizeDomainInput(domain) !== domain) throw new GateError(`starter-brands: "${domain}" is not a normalized host`)
    if (!/^[a-z0-9-]+$/.test(brand)) throw new GateError(`starter-brands: brand "${brand}" must be lowercase letters, digits or "-"`)
    out.set(domain, brand)
  }
  return out
}

/** Same family: equal keys, or one key of 5+ letters starting the other ("xhamster", "xhamsterlive"). */
export const sameBrand = (a: string, b: string): boolean => {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 5 && long.startsWith(short)
}

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

/**
 * Remove each held-back root and the hosts under it, except hosts the
 * previous release already blocked: holding a new entry back must never
 * unblock something that was blocked before.
 */
const removeHeld = (hosts: ReadonlySet<string>, roots: ReadonlySet<string>, previous: ReadonlySet<string>): Set<string> => {
  if (roots.size === 0) return new Set(hosts)
  const out = new Set<string>()
  for (const h of hosts) {
    const underRoot = roots.has(h) || parentDomains(h).some((p) => roots.has(p))
    if (!underRoot || coveredBy(previous, h)) out.add(h)
  }
  return out
}

/** The listed entry that makes `host` match: the topmost listed one among it and its parents. */
const matchingRoot = (hosts: ReadonlySet<string>, host: string): string => {
  const parents = parentDomains(host)
  for (let i = parents.length - 1; i >= 0; i--) if (hosts.has(parents[i])) return parents[i]
  return host
}

export const runBuild = (input: BuildInput): BuildOutput => {
  const warnings: string[] = []
  const psl: PublicSuffixList = parsePsl(input.psl)
  const previousHosts: ReadonlySet<string> = input.previous?.hosts ?? new Set<string>()
  const previousInfo = input.previous?.info ?? null

  // 1. Sources, each checked for a format change.
  const perSource: SourceInfo[] = []
  const sourceHosts: Set<string>[] = []
  const union = new Set<string>()
  // Hosts listed by at least one source that is not keyword-matched.
  const byOtherMethod = new Set<string>()
  for (const s of input.sources) {
    const { hosts, lines, skipped } = parseList(s.text)
    sourceHosts.push(hosts)
    if (!input.keywordMatchedSources.includes(s.id)) for (const h of hosts) byOtherMethod.add(h)
    if (skipped >= MIN_SKIPPED_LINES && skipped > MAX_SKIPPED_RATIO * lines) {
      throw new GateError(`source ${s.id}: ${skipped} of ${lines} lines unreadable (over ${MAX_SKIPPED_RATIO * 100}%); its format has probably changed`)
    }
    perSource.push({ id: s.id, commit: s.commit ?? null, sha256: sha256Hex(s.text), lines, hosts: hosts.size, skippedLines: skipped })
    for (const h of hosts) union.add(h)
  }
  const unionCount = union.size

  // 2. Hand-kept files.
  const allow = parseHostRules(input.data.allowlist, 'allowlist')
  const additions = parseHostFile(input.data.additions, 'additions')
  const paths = readDataLines(input.data.paths).map((p) => p.toLowerCase())
  const reviewed = new Set(parseHostFile(input.data.reviewedTopHits, 'reviewed-top-hits'))
  const reviewedSub = parseHostRules(input.data.reviewedTopSiteSubdomains, 'reviewed-top-site-subdomains')
  const starterExtra = parseHostFile(input.data.starterExtra, 'starter-extra')
  const starterExclude = new Set(parseHostFile(input.data.starterExclude, 'starter-exclude'))
  const canaries = parseProbes(input.data.canaries, 'canaries')
  const negatives = parseProbes(input.data.negatives, 'negatives')
  if (canaries.length === 0) throw new GateError('canaries: at least one is required')
  const asGate = <T>(fn: () => T): T => {
    try {
      return fn()
    } catch (e) {
      throw new GateError(e instanceof Error ? e.message : String(e))
    }
  }
  const protectedRules = asGate(() => parseProtectedTerms(input.data.protectedTerms))
  const reviewedProtected = asGate(() => parseReasonedHosts(input.data.reviewedProtected, 'reviewed-protected', normalizeDomainInput))
  const keywordRules = asGate(() => parseKeywordRules(input.data.keywordFalseMatches, normalizeDomainInput))
  const pending = parseHostRules(input.data.pendingReview, 'pending-review')

  for (const h of additions) {
    if (isPublicSuffix(psl, h)) throw new GateError(`additions: "${h}" is a public suffix`)
    if (ruleCovers(allow, h)) throw new GateError(`additions: "${h}" is also on the allowlist`)
    union.add(h)
  }
  for (const p of paths) {
    const host = p.split('/', 1)[0]
    if (isPublicSuffix(psl, host)) throw new GateError(`paths: the host of "${p}" is a public suffix`)
    if (underSubtree(allow, host)) throw new GateError(`paths: "${p}" is under an allowlisted domain`)
  }
  // A negative must also be allowlisted, so no source can ever list it.
  for (const n of negatives) {
    if (!ruleCovers(allow, n.host)) throw new GateError(`negatives: "${n.host}" is not on the allowlist`)
  }
  for (const h of reviewed) if (ruleCovers(allow, h)) warnings.push(`reviewed-top-hits: "${h}" is also allowlisted, so it is not blocked`)

  // 3. Public Suffix guard: a bare suffix would block every site registered under it.
  let publicSuffixesDropped = 0
  for (const h of [...union]) {
    if (isPublicSuffix(psl, h)) {
      union.delete(h)
      publicSuffixesDropped++
    }
  }

  // 3b. Protected-name gate: a recovery, Christian or Islamic name is removed
  //     unless a person reviewed it as adult (src/protected.ts).
  const reviewedProtectedSet = new Set(reviewedProtected.keys())
  const removedProtected: { host: string; terms: string[] }[] = []
  for (const h of [...union]) {
    const terms = protectedTermsOf(psl, protectedRules, h)
    if (terms.length === 0 || coveredBy(reviewedProtectedSet, h)) continue
    union.delete(h)
    removedProtected.push({ host: h, terms })
  }
  removedProtected.sort((a, b) => (a.host < b.host ? -1 : 1))
  for (const h of additions) {
    if (!union.has(h) && removedProtected.some((r) => r.host === h)) {
      throw new GateError(`additions: "${h}" has a protected name; review it into data/reviewed-protected.txt with a reason`)
    }
  }
  for (const h of reviewedProtectedSet) {
    if (protectedTermsOf(psl, protectedRules, h).length === 0) warnings.push(`reviewed-protected: "${h}" contains no protected term`)
  }

  // 3c. False keyword matches, for hosts only a keyword-matched source lists.
  const additionSet = new Set(additions)
  const removedKeyword: string[] = []
  for (const h of [...union]) {
    if (byOtherMethod.has(h) || additionSet.has(h) || !isKeywordFalseMatch(keywordRules, h)) continue
    union.delete(h)
    removedKeyword.push(h)
  }
  removedKeyword.sort()
  for (const h of keywordRules.hosts) {
    if (byOtherMethod.has(h)) warnings.push(`keyword-false-matches: "${h}" is also listed by another source, so this rule does not remove it; allowlist it instead`)
  }

  // 4. Allowlist (before the dedupe, see the top of this file).
  const afterSubtree = applyAllowlist(union, allow.subtree)
  const afterExact = applyExactAllowlist(afterSubtree.hosts, allow.exact)
  const allowlistedCount = afterSubtree.removed + afterExact.removed
  const listed = afterExact.hosts

  // 5. Review gate, top sites: every popular site the list blocks must have been reviewed.
  const ranked = parseTranco(input.tranco).slice(0, input.trancoTop)
  if (ranked.length < input.trancoTop) throw new GateError(`top-sites list has ${ranked.length} entries, expected ${input.trancoTop}`)
  const topHits = ranked.filter((d) => coveredBy(listed, d))
  const unreviewedTop = topHits.filter((d) => !reviewed.has(d))
  const keptTop = unreviewedTop.filter((d) => coveredBy(previousHosts, d))
  const heldTop = unreviewedTop.filter((d) => !coveredBy(previousHosts, d)).sort()
  const afterTop = removeHeld(listed, new Set(heldTop.map((d) => matchingRoot(listed, d))), previousHosts)
  const topSet = new Set(ranked)
  for (const h of reviewed) if (!topSet.has(h)) warnings.push(`reviewed-top-hits: "${h}" is no longer in the top ${input.trancoTop}`)

  // 6. Review gate, subdomains of the most popular sites (the site itself stays reachable,
  //    but a wrong entry such as m.vk.com would still break it for most people).
  const topSubSet = new Set(ranked.slice(0, input.subdomainRanks))
  const subOf = (set: Iterable<string>, top: ReadonlySet<string>): string[] =>
    [...set]
      .filter((h) => {
        const reg = registrableDomain(psl, h)
        return reg !== null && reg !== h && top.has(reg) && !reviewed.has(reg)
      })
      .sort()
  const subCandidates = subOf(dedupeCoveredHosts(afterTop), topSubSet)
  const unreviewedSub = subCandidates.filter((h) => !ruleCovers(reviewedSub, h))
  const keptSub = unreviewedSub.filter((h) => coveredBy(previousHosts, h))
  const heldSub = unreviewedSub.filter((h) => !coveredBy(previousHosts, h))
  const finalHosts = dedupeCoveredHosts(removeHeld(afterTop, new Set(heldSub), previousHosts))
  for (const h of reviewedSub.exact) if (!finalHosts.has(h)) warnings.push(`reviewed-top-site-subdomains: "${h}" is no longer an entry`)

  // A burst of new popular entries suggests a broken or poisoned upstream: stop.
  const heldBefore = new Set([...(previousInfo?.heldBack.topSites ?? []), ...(previousInfo?.heldBack.topSiteSubdomains ?? [])])
  // Entries in data/pending-review.txt were looked at and left undecided: they stay held back but are not news.
  const newHeld = [...heldTop, ...heldSub].filter((h) => !heldBefore.has(h) && !ruleCovers(pending, h))
  if (newHeld.length > input.maxNewHeldBack) {
    throw new GateError(
      `${newHeld.length} new unreviewed popular entries (more than ${input.maxNewHeldBack}); an upstream list may be broken or poisoned. ` +
        'See dist/held-back-candidates.txt: review each into data/reviewed-top-hits.txt, data/reviewed-top-site-subdomains.txt or data/allowlist.txt.',
      { file: 'held-back-candidates.txt', lines: newHeld },
    )
  }
  if (heldTop.length + heldSub.length > 0) warnings.push(`${heldTop.length + heldSub.length} unreviewed popular entr(ies) held back; see dist/held-back.txt`)

  // 7. Shrink gates against the previous release.
  if (previousInfo && !input.allowShrink) {
    if (finalHosts.size < MIN_TOTAL_RATIO * previousInfo.hostCount) {
      throw new GateError(`the list shrank from ${previousInfo.hostCount} to ${finalHosts.size} hosts (more than ${Math.round((1 - MIN_TOTAL_RATIO) * 100)}%)`)
    }
    for (const s of perSource) {
      const before = previousInfo.sources.find((p) => p.id === s.id)
      if (before && s.hosts < MIN_SOURCE_RATIO * before.hosts) {
        throw new GateError(`source ${s.id} shrank from ${before.hosts} to ${s.hosts} hosts (more than ${Math.round((1 - MIN_SOURCE_RATIO) * 100)}%)`)
      }
    }
    // Slow shrink: against the largest of the recent releases, not only the last one.
    const recentMax = Math.max(...previousInfo.hostCountHistory)
    if (finalHosts.size < MIN_TOTAL_RATIO * recentMax) {
      throw new GateError(
        `the list has ${finalHosts.size} hosts, more than ${Math.round((1 - MIN_TOTAL_RATIO) * 100)}% below the largest of the last ${previousInfo.hostCountHistory.length} releases (${recentMax})`,
      )
    }
  }
  if (!input.allowShrink && finalHosts.size < input.hostFloor) {
    throw new GateError(`the list has ${finalHosts.size} hosts, below the floor of ${input.hostFloor} (config.ts MIN_HOST_FLOOR)`)
  }

  // 7b. Growth gates: sudden growth means a broken or hijacked upstream as surely as shrinkage.
  let newRegistrableDomains: Record<string, number> | null = null
  if (input.previous) {
    const regCache = new Map<string, string>()
    const reg = (h: string): string => {
      let r = regCache.get(h)
      if (r === undefined) {
        r = registrableDomain(psl, h) ?? h
        regCache.set(h, r)
      }
      return r
    }
    const previousRegs = new Set<string>()
    for (const h of input.previous.hosts) previousRegs.add(reg(h))
    newRegistrableDomains = {}
    input.sources.forEach((src, i) => {
      const fresh = new Set<string>()
      for (const h of sourceHosts[i]) {
        if (!listed.has(h)) continue // removed by the allowlist or a name rule: never published
        const r = reg(h)
        if (!previousRegs.has(r)) fresh.add(r)
      }
      newRegistrableDomains![src.id] = fresh.size
    })
    if (!input.allowGrowth) {
      const growth = (pct: number): string => `more than ${Math.round(pct * 100)}%`
      if (finalHosts.size > (1 + input.maxTotalGrowth) * previousInfo!.hostCount) {
        throw new GateError(`the list grew from ${previousInfo!.hostCount} to ${finalHosts.size} hosts (${growth(input.maxTotalGrowth)}); check the sources, then re-run with allow_growth`)
      }
      for (const s of perSource) {
        const before = previousInfo!.sources.find((p) => p.id === s.id)
        if (before && s.hosts > (1 + input.maxSourceGrowth) * before.hosts) {
          throw new GateError(`source ${s.id} grew from ${before.hosts} to ${s.hosts} hosts (${growth(input.maxSourceGrowth)}); check it, then re-run with allow_growth`)
        }
        const fresh = newRegistrableDomains[s.id]
        if (fresh > input.maxNewRegistrableDomains) {
          throw new GateError(`source ${s.id} adds ${fresh} registrable domains the previous release did not list (more than ${input.maxNewRegistrableDomains}); check it, then re-run with allow_growth`)
        }
      }
    }
  }

  // 8. Compile and check the full list.
  const full = compile(finalHosts, paths, input.serial)
  assertRoundTrip(full.bytes, finalHosts, paths, 'full list')
  const header = readHayaaListHeader(full.bytes)
  if (!header || header.version !== 2 || header.serial !== input.serial || header.hostCount !== finalHosts.size) {
    throw new GateError('full list header does not match the build')
  }
  if (full.bytes.length > MAX_RAW_BYTES) throw new GateError('full list is over the app\'s 96 MiB cap')
  for (const h of finalHosts) if (isPublicSuffix(psl, h)) throw new GateError(`"${h}" is a public suffix`) // invariant

  // 9. Canaries and negatives, through the same matching rule the app uses.
  for (const c of canaries) {
    if (!hayaaListMatches(full.bytes, c.host, c.path ?? null)) throw new GateError(`canary does not match: ${c.host}${c.path ?? ''}`)
  }
  for (const n of negatives) {
    if (hayaaListMatches(full.bytes, n.host, n.path ?? null)) throw new GateError(`negative matches: ${n.host}${n.path ?? ''}`)
  }

  // 10. Starter list: the most popular listed sites, registrable domains only,
  //     at most starterPerBrand per brand, then starter-extra.txt; exactly starterSize.
  const starter: string[] = []
  const brands = parseBrands(input.data.starterBrands)
  const brandOf = (h: string): string => {
    const reg = registrableDomain(psl, h) ?? h
    return brands.get(reg) ?? brandKey(reg)
  }
  const brandCount = (b: string): number => starter.filter((h) => sameBrand(brandOf(h), b)).length
  const popularSlots = input.starterSize - starterExtra.length
  for (const d of ranked) {
    if (starter.length >= popularSlots) break
    if (!finalHosts.has(d) || starterExclude.has(d) || starterExtra.includes(d) || registrableDomain(psl, d) !== d) continue
    if (brandCount(brandOf(d)) >= input.starterPerBrand) continue
    starter.push(d)
  }
  for (const h of starterExtra) {
    if (!finalHosts.has(h)) throw new GateError(`starter-extra: "${h}" is not an entry of the full list`)
    if (starterExclude.has(h)) throw new GateError(`starter-extra: "${h}" is also in starter-exclude`)
    if (brandCount(brandOf(h)) >= input.starterPerBrand) throw new GateError(`starter-extra: "${h}" is over the ${input.starterPerBrand}-per-brand cap`)
    if (!starter.includes(h)) starter.push(h)
  }
  // Bypass coverage belongs to the full list only; a proxy name in the starter list is a mistake.
  for (const h of starter) if (/proxy|unblock/.test(h)) throw new GateError(`starter list: "${h}" looks like a proxy or bypass site; add it to starter-exclude.txt`)
  if (starter.length !== input.starterSize) throw new GateError(`starter list has ${starter.length} entries, expected exactly ${input.starterSize}`)
  const starterSet = new Set(starter)
  if (starterSet.size >= finalHosts.size || [...starterSet].some((h) => !finalHosts.has(h))) {
    throw new GateError('starter list is not a strict subset of the full list')
  }
  // Serial 0: the starter list ships inside the app and must never be taken for a monthly release.
  const starterList = compile(starterSet, [], STARTER_SERIAL)
  assertRoundTrip(starterList.bytes, starterSet, [], 'starter list')
  const starterHeader = readHayaaListHeader(starterList.bytes)
  if (!starterHeader || starterHeader.serial !== STARTER_SERIAL || starterHeader.hostCount !== starterSet.size || starterHeader.hasPaths) {
    throw new GateError('starter list header does not match the build')
  }

  // 11. Gzip, checked by an independent inflater.
  const gz = deterministicGzip(full.bytes)
  if (gz.length > MAX_GZ_BYTES) throw new GateError('compressed list is over the app\'s 40 MiB cap')
  if (sha256Hex(gunzip(gz)) !== sha256Hex(full.bytes)) throw new GateError('gzip round trip failed')

  // 12. Manifest (only the fields the app reads) and build-info.json (everything the next build compares against).
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
  const heldBack = { topSites: heldTop, topSiteSubdomains: heldSub }
  const info: BuildInfo = {
    buildInfoVersion: BUILD_INFO_VERSION,
    serial: input.serial,
    hostCount: header.hostCount,
    pathCount: full.stats.paths,
    // A reviewed shrink starts the history again; otherwise the latest releases, this one last.
    hostCountHistory: input.allowShrink || !previousInfo
      ? [header.hostCount]
      : [...previousInfo.hostCountHistory, header.hostCount].slice(-input.shrinkHistory),
    sources: perSource,
    heldBack,
  }

  // Plain-text form of the list: hosts, then page entries, each sorted.
  const text =
    [...finalHosts].sort().join('\n') + '\n' + (full.stats.paths > 0 ? decodeHayaaList(full.bytes).paths.sort().join('\n') + '\n' : '')

  const files = new Map<string, Uint8Array>([
    [`hayaa-list-${input.serial}.bin`, full.bytes],
    [gzName, gz],
    [`hayaa-list-${input.serial}.txt`, new TextEncoder().encode(text)],
    ['starter.bin', starterList.bytes],
    ['manifest.json', manifest],
    [BUILD_INFO, serializeBuildInfo(info)],
  ])
  const fileReport: BuildReport['files'] = {}
  for (const [name, bytes] of files) fileReport[name] = { bytes: bytes.length, sha256: sha256Hex(bytes) }

  const reviewAid = subOf(finalHosts, topSet)
  return {
    files,
    starter,
    heldBack,
    newHeldBack: newHeld,
    keptFromPrevious: [...keptTop, ...keptSub].sort(),
    topSiteSubdomainEntries: reviewAid,
    removedProtected,
    removedKeywordFalseMatches: removedKeyword,
    report: {
      serial: input.serial,
      previous: input.previous?.origin ?? null,
      sources: perSource,
      counts: {
        union: unionCount,
        additions: additions.length,
        publicSuffixesDropped,
        protectedNamesRemoved: removedProtected.length,
        keywordFalseMatchesRemoved: removedKeyword.length,
        allowlisted: allowlistedCount,
        finalHosts: header.hostCount,
        paths: full.stats.paths,
        pathsCoveredByHost: full.stats.pathsCoveredByHost,
        pathsCoveredByPath: full.stats.pathsCoveredByPath,
        starterHosts: starterSet.size,
        topSitesBlocked: topHits.length - heldTop.length,
        unreviewedKeptFromPrevious: keptTop.length + keptSub.length,
        heldBackTopSites: heldTop.length,
        heldBackTopSiteSubdomains: heldSub.length,
        newHeldBack: newHeld.length,
        topSiteSubdomainEntries: reviewAid.length,
      },
      newRegistrableDomains,
      files: fileReport,
      warnings,
    },
  }
}
