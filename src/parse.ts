// SPDX-License-Identifier: GPL-3.0-or-later
//
// Source-list parsing and normalization. Pure functions, no I/O.
//
// Entries are kept at the granularity the source lists use (one host per
// line, "www." stripped) and NEVER collapsed to a registrable domain. Many
// listed hosts sit under parents that are not themselves listed (blog and
// CDN platforms); collapsing would block every site on those platforms.
// Host granularity plus the parent walk at lookup time gives exactly what
// the source curators meant.

import { normalizeDomainInput } from './domains'

/** Names that appear in hosts files but are never web hosts. */
const HOSTS_FILE_NOISE = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  'ip6-localnet',
  'ip6-mcastprefix',
  'ip6-allnodes',
  'ip6-allrouters',
  'ip6-allhosts',
  '0.0.0.0',
])

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * One line of a hosts-format or plain-domain list → normalized host, or null.
 * Accepts "0.0.0.0 host", "127.0.0.1 host", "host", inline "# comments".
 */
export const parseListLine = (line: string): string | null => {
  const noComment = line.split('#', 1)[0].trim()
  if (noComment === '') return null
  const tokens = noComment.split(/\s+/)
  // hosts-file form: "<ip> <host>"; plain form: "<host>"
  const candidate = tokens.length >= 2 && IPV4.test(tokens[0]) ? tokens[1] : tokens[0]
  const lower = candidate.toLowerCase()
  if (HOSTS_FILE_NOISE.has(lower) || IPV4.test(lower)) return null
  return normalizeDomainInput(lower)
}

/**
 * Parse a whole file; returns unique hosts, how many non-comment lines it
 * has and how many of those were skipped as unreadable.
 */
export const parseList = (text: string): { hosts: Set<string>; lines: number; skipped: number } => {
  const hosts = new Set<string>()
  let lines = 0
  let skipped = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    lines++
    const host = parseListLine(line)
    if (host === null) skipped++
    else hosts.add(host)
  }
  return { hosts, lines, skipped }
}

/** True when `host` or one of its parents is in `set`: the lookup rule, over a plain set. */
export const coveredBy = (set: ReadonlySet<string>, host: string): boolean => set.has(host) || parentDomains(host).some((p) => set.has(p))

/** Every proper parent of at least two labels: "a.b.c.com" → ["b.c.com", "c.com"]. */
export const parentDomains = (host: string): string[] => {
  const labels = host.split('.')
  const out: string[] = []
  for (let i = 1; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'))
  return out
}

/**
 * Drop hosts already covered by a listed parent: the parent walk at lookup
 * time would match them anyway, so they are pure bytes. Order-independent.
 */
export const dedupeCoveredHosts = (hosts: ReadonlySet<string>): Set<string> => {
  const out = new Set<string>()
  for (const host of hosts) {
    if (!parentDomains(host).some((p) => hosts.has(p))) out.add(host)
  }
  return out
}

/**
 * Remove hosts on the allowlist, including everything under an allowlisted
 * domain. Returns what was removed as a count.
 */
export const applyAllowlist = (
  hosts: ReadonlySet<string>,
  allowlist: readonly string[],
): { hosts: Set<string>; removed: number } => {
  const out = new Set<string>()
  let removed = 0
  for (const host of hosts) {
    const hit = allowlist.some((a) => host === a || host.endsWith('.' + a))
    if (hit) removed++
    else out.add(host)
  }
  return { hosts: out, removed }
}

/**
 * Remove hosts that are allowlisted exactly ("this host itself is never
 * listed"), leaving entries for its subdomains in place. Used for platforms
 * that host many unrelated sites under one domain: the platform root must
 * never be blocked, but a listed adult site on it still is.
 */
export const applyExactAllowlist = (
  hosts: ReadonlySet<string>,
  exact: ReadonlySet<string>,
): { hosts: Set<string>; removed: number } => {
  const out = new Set<string>()
  let removed = 0
  for (const host of hosts) {
    if (exact.has(host)) removed++
    else out.add(host)
  }
  return { hosts: out, removed }
}

/**
 * Hand-kept data file → its entries: one per line, "#" starts a comment
 * (whole line or trailing), blank lines ignored. Entries are returned as
 * written (trimmed); callers normalize and validate.
 */
export const readDataLines = (text: string): string[] => {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const entry = line.split('#', 1)[0].trim()
    if (entry !== '') out.push(entry)
  }
  return out
}
