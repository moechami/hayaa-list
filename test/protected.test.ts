// SPDX-License-Identifier: GPL-3.0-or-later
//
// The two name rules: the protected-name gate (recovery, Christian and
// Islamic names are removed unless reviewed as adult) and the false keyword
// matches of a keyword-matched source (Essex, Sexton), over the rule
// functions, through the build, and over the committed data files.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { normalizeDomainInput } from '../src/domains'
import { decodeHayaaList } from '../src/format'
import { GateError, runBuild, type BuildInput } from '../src/pipeline'
import {
  isKeywordFalseMatch,
  nameLabels,
  parseKeywordRules,
  parseProtectedTerms,
  parseReasonedHosts,
  protectedTermsOf,
} from '../src/protected'
import { parsePsl } from '../src/psl'
import { SYNTHETIC_PSL, baseInput } from './synthetic'

const ROOT = join(__dirname, '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const psl = parsePsl(SYNTHETIC_PSL)

const withSource = (text: string, data: Partial<BuildInput['data']> = {}, extra: Partial<BuildInput> = {}): BuildInput => {
  const input = baseInput()
  return { ...input, ...extra, sources: [...input.sources, { id: 'extra', text }], data: { ...input.data, ...data } }
}
const hostsOf = (input: BuildInput): string[] => decodeHayaaList(runBuild(input).files.get('hayaa-list-2026110101.bin')!).hosts

describe('protected terms', () => {
  const rules = parseProtectedTerms('contains quran\ncontains recovery\nlabel dua\ncontains anonymous with porn sex\n')

  test('a term anywhere in a label, hyphens ignored, the public suffix never counted', () => {
    assert.deepEqual(protectedTermsOf(psl, rules, 'learnquran.com'), ['quran'])
    assert.deepEqual(protectedTermsOf(psl, rules, 'porn-re-covery.com'), ['recovery'])
    assert.deepEqual(protectedTermsOf(psl, rules, 'quran.someone.blogspot.com'), ['quran'])
    assert.deepEqual(nameLabels(psl, 'a.b.example.co.uk'), ['a', 'b', 'example'])
    assert.deepEqual(protectedTermsOf(psl, rules, 'ordinary.com'), [])
  })

  test('"label" matches a whole label only', () => {
    assert.deepEqual(protectedTermsOf(psl, rules, 'dua.example.com'), ['dua'])
    assert.deepEqual(protectedTermsOf(psl, rules, 'duality.com'), [])
  })

  test('"with" needs one of the other words in the name too', () => {
    assert.deepEqual(protectedTermsOf(psl, rules, 'pornanonymous.org'), ['anonymous+porn|sex'])
    assert.deepEqual(protectedTermsOf(psl, rules, 'anonymous.example.com'), [])
  })

  test('malformed lines are refused', () => {
    for (const bad of ['contains', 'contains Quran', 'label a b', 'contains x with', 'matches x', '# only a comment']) {
      assert.throws(() => parseProtectedTerms(bad), /protected-terms/, bad)
    }
  })

  test('reviewed hosts need a reason and a normalized name', () => {
    assert.deepEqual([...parseReasonedHosts('a.com  # adult\n', 'x', normalizeDomainInput)], [['a.com', 'adult']])
    assert.throws(() => parseReasonedHosts('a.com\n', 'x', normalizeDomainInput), /has no reason/)
    assert.throws(() => parseReasonedHosts('a.com #\n', 'x', normalizeDomainInput), /has no reason/)
    assert.throws(() => parseReasonedHosts('www.a.com # r\n', 'x', normalizeDomainInput), /not a normalized host/)
    assert.throws(() => parseReasonedHosts('a.com # r\na.com # r\n', 'x', normalizeDomainInput), /twice/)
  })
})

describe('the protected-name gate in the build', () => {
  test('removes a protected name; a reviewed one (and its subdomains) stays', () => {
    const text = 'quranstudy.com\nrecovery-group.org\nquranporn.com\ncdn.quranporn.com\n'
    const removed = hostsOf(withSource(text))
    for (const h of ['quranstudy.com', 'recovery-group.org', 'quranporn.com']) assert.ok(!removed.includes(h), h)
    const reviewed = hostsOf(withSource(text, { reviewedProtected: 'quranporn.com  # explicit name\n' }))
    assert.ok(reviewed.includes('quranporn.com'))
    assert.ok(!reviewed.includes('quranstudy.com'))
    const out = runBuild(withSource(text))
    assert.equal(out.report.counts.protectedNamesRemoved, 4)
    assert.deepEqual(out.removedProtected.map((r) => r.host), ['cdn.quranporn.com', 'quranporn.com', 'quranstudy.com', 'recovery-group.org'])
  })

  test('a reviewed addition must be reviewed for its protected name too', () => {
    assert.throws(() => runBuild(withSource('', { additions: 'quranporn.com\n' })), (e: unknown) => e instanceof GateError && /has a protected name/.test(e.message))
    assert.ok(hostsOf(withSource('', { additions: 'quranporn.com\n', reviewedProtected: 'quranporn.com # explicit\n' })).includes('quranporn.com'))
  })

  test('a reviewed entry without a protected term is reported as stale', () => {
    const out = runBuild(withSource('', { reviewedProtected: 'adult-one.com # explicit\n' }))
    assert.ok(out.report.warnings.some((w) => /reviewed-protected: "adult-one.com" contains no protected term/.test(w)))
  })
})

describe('false keyword matches', () => {
  const rules = parseKeywordRules('benign essex\nbenign sexton(?!ight)\nsexual porn\nsexual escort\nsexual sex\nhost church.example.com # a church\n', normalizeDomainInput)

  test('removed only when every sexual substring sits inside a benign word', () => {
    assert.equal(isKeywordFalseMatch(rules, 'essexroofing.co.uk'), true)
    assert.equal(isKeywordFalseMatch(rules, 'essexescorts.co.uk'), false) // "escort" outside
    assert.equal(isKeywordFalseMatch(rules, 'essexsexshop.com'), false) // a second "sex" outside
    assert.equal(isKeywordFalseMatch(rules, 'sextonight.com'), false) // not a benign word
    assert.equal(isKeywordFalseMatch(rules, 'jsexton.com'), true)
    assert.equal(isKeywordFalseMatch(rules, 'plainsex.com'), false) // no benign word at all
    assert.equal(isKeywordFalseMatch(rules, 'church.example.com'), true) // a host line
  })

  test('the rule file is validated', () => {
    assert.throws(() => parseKeywordRules('benign (\nsexual sex\n', normalizeDomainInput), /not a valid regular expression/)
    assert.throws(() => parseKeywordRules('benign a*\nsexual sex\n', normalizeDomainInput), /matches the empty string/)
    assert.throws(() => parseKeywordRules('benign essex\n', normalizeDomainInput), /at least one benign and one sexual/)
    assert.throws(() => parseKeywordRules('other x\nbenign a\nsexual b\n', normalizeDomainInput), /unknown kind/)
    assert.throws(() => parseKeywordRules('host WWW.A.COM\nbenign a\nsexual b\n', normalizeDomainInput), /not a normalized host/)
  })

  test('applies only to hosts that no other source lists', () => {
    const input = baseInput()
    input.keywordMatchedSources = ['kw']
    input.sources = [...input.sources, { id: 'kw', text: 'essexroofing.com\nessexporn.com\nmiddleessex.com\n' }, { id: 'other', text: 'middleessex.com\n' }]
    const out = runBuild(input)
    const hosts = decodeHayaaList(out.files.get('hayaa-list-2026110101.bin')!).hosts
    assert.ok(!hosts.includes('essexroofing.com'))
    assert.ok(hosts.includes('essexporn.com'))
    assert.ok(hosts.includes('middleessex.com')) // another source lists it
    assert.deepEqual(out.removedKeywordFalseMatches, ['essexroofing.com'])
    assert.equal(out.report.counts.keywordFalseMatchesRemoved, 1)
  })
})

describe('the committed data files', () => {
  const rules = parseProtectedTerms(read('data/protected-terms.txt'))
  const realPsl = (): ReturnType<typeof parsePsl> => psl

  test('every protected term the founder named is in data/protected-terms.txt', () => {
    const contains = new Set(rules.filter((r) => r.kind === 'contains' && r.with.length === 0).map((r) => r.term))
    for (const t of [
      'recovery', 'addict', 'sobriety', 'sober', 'quitporn', 'stopporn', 'nofap', 'rebootnation', 'yourbrainonporn', 'fightthenewdrug',
      'covenanteyes', 'exodus', 'therapy', 'therapist', 'counsel', 'church', 'bible', 'biblical', 'christ', 'gospel', 'ministry',
      'muslim', 'islam', 'quran', 'koran', 'halal', 'masjid', 'mosque', 'deen', 'imam', 'allah', 'sunnah', 'hadith', 'ummah', 'ramadan',
      'hijab', 'salah',
    ]) {
      assert.ok(contains.has(t), t)
    }
    assert.ok(rules.some((r) => r.kind === 'label' && r.term === 'dua'))
    const anon = rules.find((r) => r.kind === 'contains' && r.term === 'anonymous')
    assert.deepEqual(anon && anon.kind === 'contains' ? anon.with : null, ['porn', 'sex', 'addict'])
  })

  test('the recovery and Islamic-named sites from the audit are protected by name', () => {
    for (const h of ['yourbrainonporn.com', 'pornaddictsanonymous.org', 'sca-recovery.org', 'quranbeginners.com', 'muslimwakeup.com', 'talksofdeen.com', 'ace-muslim.tumblr.com']) {
      assert.ok(protectedTermsOf(realPsl(), rules, h).length > 0, h)
    }
  })

  test('data/reviewed-protected.txt: every entry has a reason and a protected term, and none is a recovery site', () => {
    const reviewed = parseReasonedHosts(read('data/reviewed-protected.txt'), 'reviewed-protected', normalizeDomainInput)
    assert.ok(reviewed.size > 500)
    for (const h of reviewed.keys()) assert.ok(protectedTermsOf(realPsl(), rules, h).length > 0, h)
    for (const h of ['yourbrainonporn.com', 'pornaddictsanonymous.org', 'xxxchurch.com', 'sexaddictionhelp.com', 'quranbeginners.com', 'pornographyaddiction.com']) {
      assert.ok(!reviewed.has(h), h)
    }
  })

  test('data/keyword-false-matches.txt parses and behaves on known names', () => {
    const k = parseKeywordRules(read('data/keyword-false-matches.txt'), normalizeDomainInput)
    for (const h of ['essexroofing.co.uk', 'westsussexweekly.co.uk', 'middlesexcollege.com', 'jeffsexteriorservices.com', 'glassexpanse.info', 'gasexchange.net', 'adslaanbieders.nl', 'kartalgayrimenkul.com', 'adulted.about.com']) {
      assert.equal(isKeywordFalseMatch(k, h), true, h)
    }
    for (const h of ['essexescorts.co.uk', 'couplessex.com', 'shelikessex.tumblr.com', 'princessexy.com', 'sextonight.com', 'essexgangbang.co.uk', 'missexhibitionist.tumblr.com', 'lessexophiles.com']) {
      assert.equal(isKeywordFalseMatch(k, h), false, h)
    }
  })
})
