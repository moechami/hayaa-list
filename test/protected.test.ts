// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
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
  hasStrongTerm,
  isKeywordFalseMatch,
  keywordTokens,
  nameLabels,
  parseKeywordRules,
  parseProtectedTerms,
  parseReasonedHosts,
  protectedTermsOf,
} from '../src/protected'
import { BLP_STRICT } from '../src/config'
import { parseBuildInfo } from '../src/previous'
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

  test('"not" hides an occurrence of the term inside a named word, and only that occurrence', () => {
    const r = parseProtectedTerms('contains prayer not sprayer\ncontains parish not parishilton\ncontains faith with jesus not unfaithful\n')
    assert.deepEqual(protectedTermsOf(psl, r, 'prayerforce.org'), ['prayer'])
    assert.deepEqual(protectedTermsOf(psl, r, 'hb-sprayer.com'), [])
    assert.deepEqual(protectedTermsOf(psl, r, 'sprayer-prayer.com'), ['prayer']) // the second occurrence is outside
    assert.deepEqual(protectedTermsOf(psl, r, 'allsaintsparish.org'), ['parish'])
    assert.deepEqual(protectedTermsOf(psl, r, 'parishilton-video.com'), [])
    assert.deepEqual(protectedTermsOf(psl, r, 'faithinjesus.com'), ['faith+jesus'])
    assert.deepEqual(protectedTermsOf(psl, r, 'unfaithfuljesus.com'), [])
    assert.deepEqual(protectedTermsOf(psl, r, 'faithful.com'), []) // "with" still applies
  })

  test('"tld" protects every name under a religious top-level domain', () => {
    const p = parsePsl(SYNTHETIC_PSL + '\nchurch\nchristmas\n')
    const r = parseProtectedTerms('tld church\ntld christmas\ncontains quran\n')
    assert.deepEqual(protectedTermsOf(p, r, 'gpib.church'), ['.church'])
    assert.deepEqual(protectedTermsOf(p, r, 'a.b.christmas'), ['.christmas'])
    assert.deepEqual(protectedTermsOf(p, r, 'church.com'), [])
    assert.deepEqual(protectedTermsOf(p, r, 'quran.church'), ['.church', 'quran'])
  })

  test('malformed lines are refused', () => {
    for (const bad of [
      'contains', 'contains Quran', 'label a b', 'contains x with', 'matches x', '# only a comment', 'tld', 'tld a b',
      'contains prayer not', 'contains prayer not spray', 'contains prayer not sprayer with x', 'contains x with not y', 'contains x with a not',
    ]) {
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

  test('a token counts only when it does not START inside a benign word (the boundary bug: "sext" in "sussextiles")', () => {
    const r = parseKeywordRules('benign sussex\nbenign middlesex\nsexual sex[eiostuy]\nsexual sex\nsexual porn\nsexual xx\nsexual xxx\n', normalizeDomainInput)
    assert.equal(isKeywordFalseMatch(r, 'sussextiles.co.uk'), true) // "sext" starts inside "sussex", ends after it
    assert.equal(isKeywordFalseMatch(r, 'westsussexestateagents.co.uk'), true)
    assert.equal(isKeywordFalseMatch(r, 'middlesexurology.com'), true)
    assert.equal(isKeywordFalseMatch(r, 'sussexporn.com'), false) // "porn" starts after the word
    assert.equal(isKeywordFalseMatch(r, 'sussexxx.com'), false) // "xxx" starts in the word's last letter and runs on
    assert.equal(isKeywordFalseMatch(r, 'sussexsex.com'), false)
  })

  test('safe words hide short tokens but never make a host removable on their own', () => {
    const r = parseKeywordRules('benign sussex\nbenign middlesex\nsafe photo\nsafe assist\nsafe camp\nsafe atlas\nbenign sexpo\nsexual sex\nsexual hot\nsexual ass\nsexual cam\nsexual puss\n', normalizeDomainInput)
    assert.equal(isKeywordFalseMatch(r, 'sussexphotobooth.co.uk'), true)
    assert.equal(isKeywordFalseMatch(r, 'lockassistancemiddlesex.co.uk'), true)
    assert.equal(isKeywordFalseMatch(r, 'campmiddlesex.org'), true)
    assert.equal(isKeywordFalseMatch(r, 'atlassexpo.com'), true) // "ass" lies inside "atlas" + "sexpo"
    assert.equal(isKeywordFalseMatch(r, 'bestphotos.com'), false) // a safe word alone: not removable
    assert.equal(isKeywordFalseMatch(r, 'campussymiddlesex.com'), false) // "puss" starts in "camp"'s last letter and runs on
    assert.equal(isKeywordFalseMatch(r, 'hotsussex.com'), false) // "hot" outside every word
  })

  test('every token is found, even one overlapping another', () => {
    const r = parseKeywordRules('benign essex\nsexual sex\nsexual xxx\nsexual xx\n', normalizeDomainInput)
    const tokens = keywordTokens(r, 'essexxx.com').map((t) => `${t.start}:${t.token}:${t.hidden}`)
    assert.ok(tokens.includes('2:sex:true'))
    assert.ok(tokens.includes('4:xxx:false') || tokens.includes('4:xx:false'), tokens.join(' '))
  })

  test('the rule file is validated', () => {
    assert.throws(() => parseKeywordRules('benign (\nsexual sex\n', normalizeDomainInput), /not a valid regular expression/)
    assert.throws(() => parseKeywordRules('benign a*\nsexual sex\n', normalizeDomainInput), /matches the empty string/)
    assert.throws(() => parseKeywordRules('benign essex\n', normalizeDomainInput), /at least one benign and one sexual/)
    assert.throws(() => parseKeywordRules('other x\nbenign a\nsexual b\n', normalizeDomainInput), /unknown kind/)
    assert.throws(() => parseKeywordRules('safe photo\nsexual hot\n', normalizeDomainInput), /at least one benign and one sexual/)
    assert.throws(() => parseKeywordRules('safe x?\nbenign a\nsexual b\n', normalizeDomainInput), /matches the empty string/)
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
      'recover', 'addict', 'sobriety', 'sober', 'quitporn', 'stopporn', 'nofap', 'rebootnation', 'yourbrainonporn', 'fightthenewdrug',
      'covenanteyes', 'exodus', 'therapy', 'therapist', 'counsel', 'church', 'bible', 'biblical', 'christ', 'gospel', 'ministry',
      'muslim', 'islam', 'quran', 'koran', 'halal', 'masjid', 'mosque', 'deen', 'imam', 'allah', 'sunnah', 'hadith', 'ummah', 'ramadan',
      'hijab', 'salah',
      // Widened after the second audit.
      'rehab', 'pornfreedom', 'integrity', 'stopitnow', 'pornkills', 'lutheran', 'baptist', 'methodist', 'evangelic', 'evangelho', 'catholic',
      'jewish', 'iglesia', 'chiesa', 'diocese', 'jesus', 'sermon', 'tauhid', 'tawhid', 'sunna', 'musulman', 'madrasa', 'madrassa', 'umrah',
      'umroh', 'hajj', 'hijrah', 'majlis', 'sexualhealth', 'sexualabuse', 'sexualassault', 'sexualharassment', 'scarleteen', 'plannedparenthood',
      'helpline', 'gynec', 'gynaec', 'obgyn', 'urolog', 'maranatha', 'antiporn', 'sexolog', 'ebenezer',
    ]) {
      assert.ok(contains.has(t) || rules.some((r) => r.kind === 'contains' && r.term === t), t)
    }
    for (const t of ['church', 'christmas', 'catholic', 'bible', 'mormon']) assert.ok(rules.some((r) => r.kind === 'tld' && r.term === t), t)
    assert.ok(rules.some((r) => r.kind === 'label' && r.term === 'dua'))
    const anon = rules.find((r) => r.kind === 'contains' && r.term === 'anonymous')
    assert.deepEqual(anon && anon.kind === 'contains' ? anon.with : null, ['porn', 'sex', 'addict'])
  })

  test('the recovery and Islamic-named sites from the audit are protected by name', () => {
    for (const h of ['yourbrainonporn.com', 'pornaddictsanonymous.org', 'sca-recovery.org', 'quranbeginners.com', 'muslimwakeup.com', 'talksofdeen.com', 'ace-muslim.tumblr.com']) {
      assert.ok(protectedTermsOf(realPsl(), rules, h).length > 0, h)
    }
  })

  test('the second audit\'s recovery, religious, health and abuse-support names are protected by name', () => {
    const p = realPsl()
    for (const h of [
      'overcomeporn.co', 'overcomepornography.com', 'overcomingpornography.net', 'conqueringpornography.net', 'catholicmenconquerporn.com',
      'recoverfromporn.com', 'recoveringpornjunkie.tumblr.com', 'pornkills.org', 'seekingintegrity.com', 'menssexualintegritycoaching.com',
      'pornrehab.com', 'thepornrehab.com', 'porn-freedom13.tumblr.com', 'pornfreedom2.blogspot.com', 'becomingpornfree.com', 'stopitnow.nl',
      'drugrehabrodeo.com', 'cokerehab.org', 'tauhidweb.com', 'alfakirtauhid.blogspot.com', 'asunna.com', 'madrassa-elabqari.net',
      'musulmanesonline.com', 'hanaumroh.com', 'sagarhajj.com', 'hijrahsukses.com', 'moodlemajlis.com', 'gslutheran.com', 'jesus-is-lord.com',
      'infantjesushighschool.com', 'prayerchaininternational.org', 'allsaintsparish.org', 'virginiadiocese.org', 'diocesestp.com',
      'adult-faith-formation.online', 'ezsermons.com', 'evangelio.com', 'evangelicaloutreach.org', 'somosiglesia.net', 'chiesaromana.info',
      'catholicnewsworld.com', 'firstbaptist.life', 'hartfordmethodist.org', 'jewishbookfestival.ca', 'izmirjewishheritage.com', 'scarleteen.com',
      'roo.plannedparenthood.org', 'healingsexualabuse.com', 'sexualabusehotline.com', 'sexualassaultevidencealliance.ca', 'leedssexualhealth.com',
      'sexual-health.co.nz', 'hnesexualhealth.org.au', 'americanobgyn.com', 'cosmeticgynecologydallas.com', 'piedmonturologypc.com',
      'minnesotasexualharassmentattorney.com', 'gpib.church',
    ]) {
      assert.ok(protectedTermsOf(p, rules, h).length > 0, h)
    }
    // Ordinary words that contain a term, and names that are not religious, are not protected.
    for (const h of ['tantiporno.com', 'hb-sprayer.com', 'parishilton-sextape.blog.drecom.jp', 'evangelionhentai.fr', 'unfaithfulwives.com', 'tylerfaith.com', 'youporn.faith', 'overcomic.com', 'conquer.xxx']) {
      assert.deepEqual(protectedTermsOf(p, rules, h), [], h)
    }
  })

  test('data/reviewed-protected.txt: every entry has a reason and a protected term, and none is a recovery site', () => {
    const reviewed = parseReasonedHosts(read('data/reviewed-protected.txt'), 'reviewed-protected', normalizeDomainInput)
    assert.ok(reviewed.size > 500)
    for (const h of reviewed.keys()) assert.ok(protectedTermsOf(realPsl(), rules, h).length > 0, h)
    for (const h of ['yourbrainonporn.com', 'pornaddictsanonymous.org', 'xxxchurch.com', 'sexaddictionhelp.com', 'quranbeginners.com', 'pornographyaddiction.com']) {
      assert.ok(!reviewed.has(h), h)
    }
    for (const h of ['recoverfromporn.com', 'pornrehab.com', 'thepornrehab.com', 'becomingpornfree.com', 'overcomeporn.co', 'scarleteen.com', 'sexualabusehotline.com', 'leedssexualhealth.com', 'gpib.church', 'jesus-is-lord.com', 'catholicnewsworld.com', 'jewishbookfestival.ca']) {
      assert.ok(!reviewed.has(h), h)
    }
    // Nothing under .church or .christmas is reviewed without an explicit word or a porn brand.
    for (const h of reviewed.keys()) {
      if (/\.(church|christmas)$/.test(h)) assert.match(h, /porn|xxx|sex(?!y\.)|xnxx|xvideos|tube8|beeg|bokep/, h)
    }
  })

  test('data/keyword-false-matches.txt parses and behaves on known names', () => {
    const k = parseKeywordRules(read('data/keyword-false-matches.txt'), normalizeDomainInput)
    for (const h of [
      'essexroofing.co.uk', 'westsussexweekly.co.uk', 'middlesexcollege.com', 'jeffsexteriorservices.com', 'glassexpanse.info', 'gasexchange.net',
      'adslaanbieders.nl', 'kartalgayrimenkul.com', 'adulted.about.com',
      // The second audit: the boundary bug, short tokens inside safe words, and "s" + an ordinary "ex-" word.
      'sussextiles.co.uk', 'westsussexestateagents.co.uk', 'wessexutilities.co.uk', 'middlesexurology.com', 'sussexphotobooth.co.uk',
      'lockassistancemiddlesex.co.uk', 'campmiddlesex.org', 'twistedpretzelsexpress.com', 'thenewsexpressbd.com', 'twochairsexchange.ca',
      'themindsexplorer.com', 'themillennialsexpert.com', 'thenavarrosexperiences.com', 'thenjsexport.shop', 'themirrorunisexsalon.in',
      'cursosexpertos.org', 'tworiversexcavatlng.com', 'thenewsexplainer.com', 'wilsonsexecutivecars.co.uk', 'nexusexpeditions.com',
      'coastslotsexchange.shop', 'habanosexclusive.com', 'focusexpand.com', 'footnotesexhibition.ca', 'crushthisexam.com', 'serviciosexternosadm.com',
      'linksysextendersetupp.com', 'focusexcellence.com', 'cosmosextracts.com', 'sextants.sbs', 'gslutheran.com', '1012betsextou.com', 'atlassexpo.com',
    ]) {
      assert.equal(isKeywordFalseMatch(k, h), true, h)
    }
    for (const h of [
      'essexescorts.co.uk', 'couplessex.com', 'shelikessex.tumblr.com', 'princessexy.com', 'sextonight.com', 'essexgangbang.co.uk', 'missexhibitionist.tumblr.com',
      'lessexophiles.com',
      // Explicit words next to an "ex-" word, and "ex-" words that are themselves sexual.
      'phonesexaction.com', 'teensexposed.net', 'twistysexposed.com', 'xxxsexhibitionists.com', 'adultsextrailers.nl', 'thaisextour.com',
      'shemalesexplorer.com', 'phonesextranny.com', 'voyeurmeetsexhibitionest.tumblr.com', 'videosexitalia.it', 'amateursexamateurs.com',
      'essexsexshop.com', 'freesexpornvideo.com', 'bestsexite.com',
    ]) {
      assert.equal(isKeywordFalseMatch(k, h), false, h)
    }
  })
})

describe('BLP_STRICT (prepared, off)', () => {
  const k = parseKeywordRules(read('data/keyword-false-matches.txt'), normalizeDomainInput)

  test('is off in src/config.ts', () => {
    assert.equal(BLP_STRICT, false)
  })

  test('strong terms count only outside ordinary words', () => {
    for (const h of ['freesexvideos.com', 'hotpornclips.net', 'xxx-tube.org', 'mynudes.tumblr.com', 'javhd.today', 'adultvideoworld.com', 'livewebcamsex.de', 'escortparis.fr', 'bigtits.com']) {
      assert.equal(hasStrongTerm(k, h), true, h)
    }
    for (const h of ['sussextiles.co.uk', 'essexroofing.co.uk', 'lespetitsplats.fr', 'cocktailbar.com', 'javascript.info', 'adultdaycare.org', 'webcamreviews.com', 'unisexsalon.in', 'girlsexplorer.com', 'atlantagolfacademy.com']) {
      assert.equal(hasStrongTerm(k, h), false, h)
    }
  })

  test('in the build: a host only a keyword-matched source lists needs a strong term; others and reviewed hosts stay', () => {
    const input = baseInput()
    input.keywordMatchedSources = ['kw']
    input.sources = [...input.sources, { id: 'kw', text: 'quietname.com\nfreeporn.com\nshared.com\nreviewedquiet.com\n' }, { id: 'other', text: 'shared.com\n' }]
    input.data = { ...input.data, additions: 'reviewedquiet.com\n', keywordFalseMatches: read('data/keyword-false-matches.txt') }
    const off = runBuild(input)
    assert.ok(decodeHayaaList(off.files.get('hayaa-list-2026110101.bin')!).hosts.includes('quietname.com'))
    assert.equal(off.report.counts.heldBackBlpStrict, 0)
    const on = runBuild({ ...input, blpStrict: true })
    const hosts = decodeHayaaList(on.files.get('hayaa-list-2026110101.bin')!).hosts
    assert.ok(!hosts.includes('quietname.com'))
    for (const h of ['freeporn.com', 'shared.com', 'reviewedquiet.com']) assert.ok(hosts.includes(h), h)
    assert.deepEqual(on.heldBackBlpStrict, ['quietname.com'])
    const info = parseBuildInfo(new TextDecoder().decode(on.files.get('build-info.json')))
    assert.deepEqual([info.blpStrict, info.heldBackBlpStrict], [true, 1])
  })
})
