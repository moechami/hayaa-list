// SPDX-License-Identifier: GPL-3.0-or-later
//
// Public Suffix List (https://publicsuffix.org) handling, used at build time
// only. Both sections (ICANN and private) count: "co.uk" and "blogspot.com"
// are both suffixes under which unrelated people register their own sites,
// so neither may ever be a list entry. The parent walk at lookup time would
// otherwise turn one such entry into a block of every site beneath it.

import punycode from 'punycode/'

export type PublicSuffixList = {
  /** Plain rules, ASCII form: "co.uk", "blogspot.com". */
  rules: Set<string>
  /** Wildcard rules without the "*.": "*.ck" is stored as "ck". */
  wildcards: Set<string>
  /** Exception rules without the "!": "!www.ck" is stored as "www.ck". */
  exceptions: Set<string>
  /** Plain and wildcard rules of the list's private section (run by companies, not registries). */
  privateRules: Set<string>
  privateWildcards: Set<string>
}

const toAscii = (rule: string): string => punycode.toASCII(rule.normalize('NFC')).toLowerCase()

/** Parse public_suffix_list.dat. Rules are converted to their ASCII (punycode) form. */
export const parsePsl = (text: string): PublicSuffixList => {
  const psl: PublicSuffixList = { rules: new Set(), wildcards: new Set(), exceptions: new Set(), privateRules: new Set(), privateWildcards: new Set() }
  let inPrivate = false
  for (const raw of text.split(/\r?\n/)) {
    if (raw.includes('===BEGIN PRIVATE DOMAINS===')) inPrivate = true
    if (raw.includes('===END PRIVATE DOMAINS===')) inPrivate = false
    // A rule is the first whitespace-free token of a non-comment line.
    const line = raw.trim().split(/\s+/, 1)[0]
    if (!line || line.startsWith('//')) continue
    if (line.startsWith('!')) psl.exceptions.add(toAscii(line.slice(1)))
    else if (line.startsWith('*.')) {
      psl.wildcards.add(toAscii(line.slice(2)))
      if (inPrivate) psl.privateWildcards.add(toAscii(line.slice(2)))
    } else {
      psl.rules.add(toAscii(line))
      if (inPrivate) psl.privateRules.add(toAscii(line))
    }
  }
  if (psl.rules.size < 1000) throw new Error('public suffix list looks truncated')
  return psl
}

/** True when the public suffix `suffix` comes from the list's private section. */
export const isPrivateSuffix = (psl: PublicSuffixList, suffix: string): boolean =>
  psl.privateRules.has(suffix) || psl.privateWildcards.has(suffix.slice(suffix.indexOf('.') + 1))

/** True when `host` is itself a public suffix (so it must never be an entry). */
export const isPublicSuffix = (psl: PublicSuffixList, host: string): boolean => {
  if (psl.exceptions.has(host)) return false
  if (psl.rules.has(host)) return true
  const dot = host.indexOf('.')
  if (dot < 0) return true // the implicit "*" rule: every TLD
  return psl.wildcards.has(host.slice(dot + 1))
}

/**
 * The registrable domain ("eTLD+1") of `host`, or null when the host is a
 * public suffix itself. "a.b.example.co.uk" → "example.co.uk".
 */
export const registrableDomain = (psl: PublicSuffixList, host: string): string | null => {
  const labels = host.split('.')
  let suffixLabels = 1 // the implicit "*" rule
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.')
    if (psl.exceptions.has(candidate)) {
      suffixLabels = labels.length - i - 1
      break
    }
    if (isPublicSuffix(psl, candidate)) {
      suffixLabels = labels.length - i
      break
    }
  }
  if (labels.length <= suffixLabels) return null
  return labels.slice(labels.length - suffixLabels - 1).join('.')
}
