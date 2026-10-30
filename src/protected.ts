// SPDX-License-Identifier: GPL-3.0-or-later
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
//
// 2. False keyword matches. Some sources (config.ts KEYWORD_MATCHED_SOURCES)
//    were built partly by matching words such as "sex" inside names, which
//    also catches "essex" and "sexton". For hosts that ONLY such a source
//    lists, data/keyword-false-matches.txt names benign words (regular
//    expressions) and sexual-looking substrings: a host with a benign word
//    and no sexual-looking substring outside every benign word is removed.
//    It also names single hosts ("host <name>").

import { readDataLines } from './parse'
import { registrableDomain, type PublicSuffixList } from './psl'

const TERM = /^[a-z0-9]+$/

export type ProtectedRule =
  | { kind: 'contains'; term: string; with: string[] }
  | { kind: 'label'; term: string }

/** data/protected-terms.txt → rules. Throws on a malformed line. */
export const parseProtectedTerms = (text: string): ProtectedRule[] => {
  const out: ProtectedRule[] = []
  for (const line of readDataLines(text)) {
    const words = line.split(/\s+/)
    const [kind, term] = words
    const bad = (): Error => new Error(`protected-terms: "${line}" is not "contains <term>", "label <term>" or "contains <term> with <term>..."`)
    if (term === undefined || !TERM.test(term)) throw bad()
    if (kind === 'label' && words.length === 2) out.push({ kind: 'label', term })
    else if (kind === 'contains' && words.length === 2) out.push({ kind: 'contains', term, with: [] })
    else if (kind === 'contains' && words[2] === 'with' && words.length > 3 && words.slice(3).every((w) => TERM.test(w))) {
      out.push({ kind: 'contains', term, with: words.slice(3) })
    } else throw bad()
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

/** The protected terms `host` matches (empty when none). */
export const protectedTermsOf = (psl: PublicSuffixList, rules: readonly ProtectedRule[], host: string): string[] => {
  const labels = nameLabels(psl, host)
  const flat = labels.map((l) => l.replace(/-/g, ''))
  const name = flat.join('.')
  const hits: string[] = []
  for (const r of rules) {
    if (r.kind === 'label') {
      if (labels.includes(r.term) || flat.includes(r.term)) hits.push(r.term)
    } else if (flat.some((l) => l.includes(r.term)) && (r.with.length === 0 || r.with.some((w) => name.includes(w)))) {
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

export type KeywordRules = { benign: RegExp[]; sexual: RegExp; hosts: Set<string> }

/** data/keyword-false-matches.txt → rules. Every regular expression must compile and must not match "". */
export const parseKeywordRules = (text: string, normalize: (h: string) => string | null): KeywordRules => {
  const benign: RegExp[] = []
  const sexual: string[] = []
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
    if (kind !== 'benign' && kind !== 'sexual') throw new Error(`keyword-false-matches: unknown kind "${kind}"`)
    let re: RegExp
    try {
      re = new RegExp(value, 'g')
    } catch {
      throw new Error(`keyword-false-matches: "${value}" is not a valid regular expression`)
    }
    if (re.test('')) throw new Error(`keyword-false-matches: "${value}" matches the empty string`)
    if (kind === 'benign') benign.push(re)
    else sexual.push(value)
  }
  if (benign.length === 0 || sexual.length === 0) throw new Error('keyword-false-matches: needs at least one benign and one sexual pattern')
  return { benign, sexual: new RegExp(sexual.join('|'), 'g'), hosts }
}

/**
 * True when every sexual-looking substring of `host` lies inside a benign
 * word and the host has at least one benign word: the name is in the list
 * only because a keyword matched inside an ordinary word. Also true for a
 * host named on a "host" line.
 */
export const isKeywordFalseMatch = (rules: KeywordRules, host: string): boolean => {
  if (rules.hosts.has(host)) return true
  const spans: [number, number][] = []
  for (const re of rules.benign) {
    re.lastIndex = 0
    for (let m = re.exec(host); m !== null; m = re.exec(host)) {
      spans.push([m.index, m.index + m[0].length])
      if (m[0].length === 0) re.lastIndex++
    }
  }
  if (spans.length === 0) return false
  const s = rules.sexual
  s.lastIndex = 0
  for (let m = s.exec(host); m !== null; m = s.exec(host)) {
    const start = m.index
    const end = start + m[0].length
    if (!spans.some(([a, b]) => start >= a && end <= b)) return false
    if (m[0].length === 0) s.lastIndex++
  }
  return true
}
