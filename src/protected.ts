// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// Two name rules that remove entries before anything is published.
//
// 1. The protected-name gate. A host whose name (every label except the
//    public suffix) contains a protected term, a word of recovery, faith or
//    Islam such as "recovery", "church" or "quran", is removed unless a person
//    reviewed it as genuinely adult (data/reviewed-protected.txt, one line per
//    host with the reason). Blocking a recovery or religious site in a
//    recovery app is worse than missing an adult one, and the user cannot
//    override the Blocker, so the burden of proof sits on the entry.
//    The terms are data (data/protected-terms.txt):
//      contains <term>                 any label contains it (hyphens ignored)
//      label <term>                    a whole label equals it
//      contains <term> with <a> <b>    the name contains the term and also a or b
//      contains <term> not <x> <y>     as "contains", but an occurrence of the
//                                      term inside x or y does not count
//                                      ("prayer" not "sprayer"); "with" and
//                                      "not" can be combined, "with" first
//      tld <label>                     the host's top-level domain is the label
//                                      (".church", ".christmas"): a religious
//                                      top-level domain protects every name
//                                      under it, which the name rule (public
//                                      suffix never counted) would miss
//
// 2. False keyword matches. Some sources (config.ts KEYWORD_MATCHED_SOURCES)
//    were built partly by matching words such as "sex" inside names, which
//    also catches "essex" and "sexton". For hosts that ONLY such a source
//    lists, data/keyword-false-matches.txt names benign words (regular
//    expressions), safe words and sexual-looking substrings: a host with a
//    benign word, whose every sexual-looking token starts inside a benign
//    or safe word, is removed ("sussextiles": the "sext" starts inside
//    "sussex"). Safe words ("photo", "camp") only hide short tokens such as
//    "hot" and "cam"; they never make a host removable on their own. It
//    also names single hosts ("host <name>").

import { readDataLines } from './parse'
import { registrableDomain, type PublicSuffixList } from './psl'

const TERM = /^[a-z0-9]+$/

export type ProtectedRule =
  | { kind: 'contains'; term: string; with: string[]; not: string[] }
  | { kind: 'label'; term: string }
  | { kind: 'tld'; term: string }

/** data/protected-terms.txt → rules. Throws on a malformed line. */
export const parseProtectedTerms = (text: string): ProtectedRule[] => {
  const out: ProtectedRule[] = []
  for (const line of readDataLines(text)) {
    const words = line.split(/\s+/)
    const [kind, term] = words
    const bad = (): Error =>
      new Error(`protected-terms: "${line}" is not "contains <term> [with <term>...] [not <word>...]", "label <term>" or "tld <label>"`)
    if (term === undefined || !TERM.test(term)) throw bad()
    if ((kind === 'label' || kind === 'tld') && words.length === 2) {
      out.push({ kind, term })
      continue
    }
    if (kind !== 'contains') throw bad()
    // contains <term> [with <a> <b>...] [not <x> <y>...]
    const rest = words.slice(2)
    const notAt = rest.indexOf('not')
    const withPart = notAt < 0 ? rest : rest.slice(0, notAt)
    const notPart = notAt < 0 ? [] : rest.slice(notAt + 1)
    if (withPart.length > 0 && (withPart[0] !== 'with' || withPart.length < 2)) throw bad()
    const withWords = withPart.slice(1)
    if (notAt >= 0 && notPart.length === 0) throw bad()
    if (![...withWords, ...notPart].every((w) => TERM.test(w) && w !== 'with' && w !== 'not')) throw bad()
    // An exception must contain the term, or it could never hide an occurrence of it.
    if (notPart.some((x) => !x.includes(term))) throw bad()
    out.push({ kind: 'contains', term, with: withWords, not: notPart })
  }
  if (out.length === 0) throw new Error('protected-terms: no terms')
  return out
}

/** The labels of `host` that are not its public suffix ("a.b.example.co.uk" → a, b, example). */
export const nameLabels = (psl: PublicSuffixList, host: string): string[] => {
  const reg = registrableDomain(psl, host)
  const labels = host.split('.')
  if (reg === null) return []
  const suffixLabels = reg.split('.').length - 1
  return labels.slice(0, labels.length - suffixLabels)
}

/** True when `label` contains `term` at a position not inside one of the `not` words. */
const containsOutside = (label: string, term: string, not: readonly string[]): boolean => {
  for (let i = label.indexOf(term); i >= 0; i = label.indexOf(term, i + 1)) {
    const hidden = not.some((x) => {
      // x covers [i, i + term.length) when it starts at some s with i + term.length - x.length <= s <= i.
      const s = label.indexOf(x, Math.max(0, i + term.length - x.length))
      return s >= 0 && s <= i
    })
    if (!hidden) return true
  }
  return false
}

/** The protected terms `host` matches (empty when none). */
export const protectedTermsOf = (psl: PublicSuffixList, rules: readonly ProtectedRule[], host: string): string[] => {
  const labels = nameLabels(psl, host)
  const flat = labels.map((l) => l.replace(/-/g, ''))
  const name = flat.join('.')
  const tld = host.slice(host.lastIndexOf('.') + 1)
  const hits: string[] = []
  for (const r of rules) {
    if (r.kind === 'label') {
      if (labels.includes(r.term) || flat.includes(r.term)) hits.push(r.term)
    } else if (r.kind === 'tld') {
      if (tld === r.term) hits.push(`.${r.term}`)
    } else if (flat.some((l) => containsOutside(l, r.term, r.not)) && (r.with.length === 0 || r.with.some((w) => name.includes(w)))) {
      hits.push(r.with.length ? `${r.term}+${r.with.join('|')}` : r.term)
    }
  }
  return hits
}

/** A hand-kept "host  # reason" file in which every line must give its reason. */
export const parseReasonedHosts = (text: string, what: string, normalize: (h: string) => string | null): Map<string, string> => {
  const out = new Map<string, string>()
  for (const raw of text.split(/\r?\n/)) {
    const hash = raw.indexOf('#')
    const entry = (hash < 0 ? raw : raw.slice(0, hash)).trim()
    if (entry === '') continue
    const reason = hash < 0 ? '' : raw.slice(hash + 1).trim()
    if (reason === '') throw new Error(`${what}: "${entry}" has no reason (write it after a "#")`)
    if (normalize(entry) !== entry) throw new Error(`${what}: "${entry}" is not a normalized host`)
    if (out.has(entry)) throw new Error(`${what}: "${entry}" is listed twice`)
    out.set(entry, reason)
  }
  return out
}

export type KeywordRules = {
  /** Non-sexual words that contain a sexual-looking substring; a host needs one to be removed. */
  benign: RegExp[]
  /** Ordinary words that hide a short sexual-looking token ("photo", "camp") but never qualify a host on their own. */
  safe: RegExp[]
  /** Every sexual-looking pattern as one sticky alternation, and each on its own (sticky). */
  sexual: RegExp
  sexualEach: RegExp[]
  /** Strong explicit terms (config.ts BLP_STRICT), each sticky. */
  strong: RegExp[]
  hosts: Set<string>
}

/** data/keyword-false-matches.txt → rules. Every regular expression must compile and must not match "". */
export const parseKeywordRules = (text: string, normalize: (h: string) => string | null): KeywordRules => {
  const benign: RegExp[] = []
  const safe: RegExp[] = []
  const sexual: string[] = []
  const strong: RegExp[] = []
  const hosts = new Set<string>()
  for (const line of readDataLines(text)) {
    const space = line.search(/\s/)
    const kind = space < 0 ? line : line.slice(0, space)
    const value = space < 0 ? '' : line.slice(space).trim()
    if (value === '' || /\s/.test(value)) throw new Error(`keyword-false-matches: "${line}" must be "<kind> <value>"`)
    if (kind === 'host') {
      if (normalize(value) !== value) throw new Error(`keyword-false-matches: "${value}" is not a normalized host`)
      hosts.add(value)
      continue
    }
    if (kind !== 'benign' && kind !== 'safe' && kind !== 'sexual' && kind !== 'strong') throw new Error(`keyword-false-matches: unknown kind "${kind}"`)
    let re: RegExp
    try {
      re = new RegExp(value, 'g')
    } catch {
      throw new Error(`keyword-false-matches: "${value}" is not a valid regular expression`)
    }
    if (re.test('')) throw new Error(`keyword-false-matches: "${value}" matches the empty string`)
    if (kind === 'benign') benign.push(re)
    else if (kind === 'safe') safe.push(re)
    else if (kind === 'strong') strong.push(new RegExp(value, 'y'))
    else sexual.push(value)
  }
  if (benign.length === 0 || sexual.length === 0) throw new Error('keyword-false-matches: needs at least one benign and one sexual pattern')
  return { benign, safe, sexual: new RegExp(sexual.join('|'), 'y'), sexualEach: sexual.map((s) => new RegExp(s, 'y')), strong, hosts }
}

/** Every [start, end) where one of `patterns` matches in `host`. */
const spansOf = (patterns: readonly RegExp[], host: string): [number, number][] => {
  const out: [number, number][] = []
  for (const re of patterns) {
    re.lastIndex = 0
    for (let m = re.exec(host); m !== null; m = re.exec(host)) {
      out.push([m.index, m.index + m[0].length])
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return out
}

const matchesAt = (re: RegExp, host: string, i: number): RegExpExecArray | null => {
  re.lastIndex = i
  return re.exec(host)
}

/**
 * For each position of `host`, where the run of letters covered by benign
 * and safe words (adjacent words joined: "atlas" + "sexpo") that covers it
 * ends; -1 when no word covers it.
 */
const wordReach = (rules: KeywordRules, host: string): number[] => {
  const spans = [...spansOf(rules.benign, host), ...spansOf(rules.safe, host)]
  const covered = new Array<boolean>(host.length + 1).fill(false)
  for (const [a, b] of spans) for (let i = a; i < b; i++) covered[i] = true
  const reach = new Array<number>(host.length + 1).fill(-1)
  for (let i = host.length - 1; i >= 0; i--) if (covered[i]) reach[i] = covered[i + 1] ? reach[i + 1] : i + 1
  return reach
}

/**
 * The sexual-looking tokens of `host`, each at the position it starts, and
 * whether a safe word hides it. A token is hidden when it starts inside a
 * benign or safe word ("sussex" hides the "sext" of "sussextiles", "photo"
 * the "hot" of "photobooth"), with one guard: a token that starts in the
 * last one or two letters of the word and runs past its end ("camp" +
 * "pussy") shares too little with it to be part of it, and is not hidden.
 * In general a token is hidden when at least min(3, its length) of its
 * letters, from its start, lie inside words (two adjacent words count as
 * one: the "ass" of "atlassexpo" lies inside "atlas" + "sexpo").
 */
export const keywordTokens = (rules: KeywordRules, host: string): { start: number; token: string; hidden: boolean }[] => {
  const reach = wordReach(rules, host)
  const out: { start: number; token: string; hidden: boolean }[] = []
  for (let i = 0; i < host.length; i++) {
    const end = reach[i]
    if (end < 0 || end - i >= 3) {
      // Outside every word, or at least three letters from its end: one alternative decides.
      const m = matchesAt(rules.sexual, host, i)
      if (m) out.push({ start: i, token: m[0], hidden: end >= 0 })
      continue
    }
    // In the last one or two letters of a word: every alternative is checked, so a long token cannot hide behind a short one.
    for (const re of rules.sexualEach) {
      const m = matchesAt(re, host, i)
      if (m) out.push({ start: i, token: m[0], hidden: i + m[0].length <= end })
    }
  }
  return out
}

/**
 * True when the host has at least one benign word and every sexual-looking
 * token in it is hidden by a benign or safe word (keywordTokens): the name
 * is in the list only because a keyword matched inside ordinary words. Also
 * true for a host named on a "host" line.
 */
export const isKeywordFalseMatch = (rules: KeywordRules, host: string): boolean => {
  if (rules.hosts.has(host)) return true
  if (spansOf(rules.benign, host).length === 0) return false
  return keywordTokens(rules, host).every((t) => t.hidden)
}

// ---------------------------------------------------------------------------
// 3. Ordinary names (data/ordinary-names.txt): a host whose name reads as an
//    ordinary business, school, sport or gambling site, with no adult-looking
//    word anywhere in it, is removed. See the data file for why.

export type OrdinaryRules = { ordinary: RegExp; adult: RegExp }

/** data/ordinary-names.txt → rules. Every pattern must compile and must not match "". */
export const parseOrdinaryRules = (text: string): OrdinaryRules => {
  const ordinary: string[] = []
  const adult: string[] = []
  for (const line of readDataLines(text)) {
    const m = /^(ordinary|adult)\s+(\S+)$/.exec(line)
    if (!m) throw new Error(`ordinary-names: "${line}" must be "ordinary <pattern>" or "adult <pattern>"`)
    let re: RegExp
    try {
      re = new RegExp(m[2])
    } catch {
      throw new Error(`ordinary-names: "${m[2]}" is not a valid regular expression`)
    }
    if (re.test('')) throw new Error(`ordinary-names: "${m[2]}" matches the empty string`)
    ;(m[1] === 'ordinary' ? ordinary : adult).push(m[2])
  }
  if (ordinary.length === 0 || adult.length === 0) throw new Error('ordinary-names: needs at least one ordinary and one adult pattern')
  return { ordinary: new RegExp(ordinary.join('|')), adult: new RegExp(adult.join('|')) }
}

/** True when the name of `host` (labels except the public suffix) is ordinary and nothing in the host looks adult. */
export const isOrdinaryName = (psl: PublicSuffixList, rules: OrdinaryRules, host: string): boolean => {
  const name = nameLabels(psl, host).join('.')
  return name !== '' && rules.ordinary.test(name) && !rules.adult.test(host)
}

/**
 * True when `host` contains a strong explicit term ("strong" lines: porn,
 * xxx, sex, hentai, nude, fuck, escort and similar) that is not hidden by a
 * benign or safe word, by the same rule as keywordTokens: the "sex" of
 * "sussextiles" or the "tits" of "petits" does not count. Used by
 * config.ts BLP_STRICT.
 */
export const hasStrongTerm = (rules: KeywordRules, host: string): boolean => {
  if (rules.strong.length === 0) return false
  const reach = wordReach(rules, host)
  for (let i = 0; i < host.length; i++) {
    for (const re of rules.strong) {
      re.lastIndex = i
      const m = re.exec(host)
      if (m === null) continue
      const end = reach[i]
      const inside = end < 0 ? 0 : Math.min(end, i + m[0].length) - i
      if (inside < Math.min(3, m[0].length)) return true
    }
  }
  return false
}
