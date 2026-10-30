// SPDX-License-Identifier: GPL-3.0-or-later
//
// Education and government hosts. A school, university, ministry or health
// service is almost never an adult site, and blocking one in an app whose
// users cannot override it is unacceptable, so a listed host whose
// registrable domain sits under an education or government public suffix
// (edu, gov, mil, ac.uk, sch.id, k12.tr, gob.mx, gouv.fr, go.jp, nhs.uk and
// similar) is held back until a person reviews it as adult into
// data/reviewed-edu-gov.txt. Such entries are usually hijacked or spammed
// pages ("sextelefon.edu.pl"), a homepage that happens to contain a word
// ("xxx.lanl.gov", the old arXiv), or a mistake.
//
// The suffix is read from the Public Suffix List. ICANN suffixes count when
// one of their labels other than the top-level domain is an education or
// government label (config.ts EDU_GOV_LABELS), and the edu, gov and mil
// top-level domains count themselves. Suffixes from the list's private
// section are run by companies (dynamic DNS, free subdomains), so they count
// only with a "gov" label (service.gov.uk, gov.scot).

import { isPrivateSuffix, registrableDomain, type PublicSuffixList } from './psl'

export type EduGovRules = {
  /** Labels that mark an education or government suffix ("ac", "gov", "sch"). */
  labels: ReadonlySet<string>
  /** Top-level domains that are themselves education or government ("edu", "gov", "mil"). */
  tlds: ReadonlySet<string>
  /** Whole suffixes that count although no label marks them ("nic.in"). */
  extra: ReadonlySet<string>
  /** Whole suffixes that do not count although a label marks them ("go.it", the province of Gorizia). */
  excluded: ReadonlySet<string>
}

/** The public suffix of `host` ("a.b.example.ac.uk" → "ac.uk"), or null when the host is itself one. */
export const publicSuffixOf = (psl: PublicSuffixList, host: string): string | null => {
  const reg = registrableDomain(psl, host)
  return reg === null ? null : reg.slice(reg.indexOf('.') + 1)
}

/** The education or government suffix `host` sits under, or null. */
export const eduGovSuffix = (psl: PublicSuffixList, rules: EduGovRules, host: string): string | null => {
  const suffix = publicSuffixOf(psl, host)
  if (suffix === null || rules.excluded.has(suffix)) return null
  if (rules.extra.has(suffix)) return suffix
  const labels = suffix.split('.')
  const tld = labels[labels.length - 1]
  if (rules.tlds.has(tld)) return suffix
  const inner = labels.slice(0, -1)
  if (isPrivateSuffix(psl, suffix)) return inner.includes('gov') ? suffix : null
  return inner.some((l) => rules.labels.has(l)) ? suffix : null
}
