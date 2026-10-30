// SPDX-License-Identifier: GPL-3.0-or-later
//
// Education and government hosts are held back until reviewed: the suffix
// rule (ICANN labels, edu/gov/mil top-level domains, private suffixes only
// with "gov"), the hold-back in the build, and the committed review file.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { EDU_GOV_EXCLUDED_SUFFIXES, EDU_GOV_EXTRA_SUFFIXES, EDU_GOV_LABELS, EDU_GOV_TLDS } from '../src/config'
import { normalizeDomainInput } from '../src/domains'
import { eduGovSuffix, publicSuffixOf } from '../src/edugov'
import { decodeHayaaList } from '../src/format'
import { runBuild, type BuildInput } from '../src/pipeline'
import { parseBuildInfo } from '../src/previous'
import { parseReasonedHosts } from '../src/protected'
import { parsePsl } from '../src/psl'
import { SYNTHETIC_PSL, baseInput } from './synthetic'

const PSL = parsePsl(
  [
    '// ===BEGIN ICANN DOMAINS===',
    SYNTHETIC_PSL.split('// ===BEGIN PRIVATE DOMAINS===')[0].replace('// ===BEGIN ICANN DOMAINS===', ''),
    'edu', 'gov', 'mil', 'ac', 'school', 'it', 'go.it', 'jp', 'go.jp', 'ac.uk', 'nhs.uk', 'police.uk', 'id', 'sch.id', 'tr', 'k12.tr', 'mx', 'gob.mx',
    'in', 'nic.in', 'ac.in', 'pl', 'edu.pl', 'fr', 'gouv.fr', 'scot', 'gov.scot',
    '// ===BEGIN PRIVATE DOMAINS===',
    'blogspot.com', 'service.gov.uk', 'go.dyndns.org', 'edu.eu.org', 'sch.tf', '*.ac.example.dev',
    ...Array.from({ length: 1000 }, (_, i) => `filler${i}`),
  ].join('\n'),
)
const RULES = {
  labels: new Set(EDU_GOV_LABELS),
  tlds: new Set(EDU_GOV_TLDS),
  extra: new Set(EDU_GOV_EXTRA_SUFFIXES),
  excluded: new Set(EDU_GOV_EXCLUDED_SUFFIXES),
}

describe('education and government suffixes', () => {
  test('ICANN suffixes with an education or government label, and the edu, gov and mil top-level domains', () => {
    for (const [h, s] of [
      ['uos.ac.uk', 'ac.uk'], ['a.b.uos.ac.uk', 'ac.uk'], ['lscs.sch.id', 'sch.id'], ['bahcesehir.k12.tr', 'k12.tr'], ['comapatecoman.gob.mx', 'gob.mx'],
      ['x.gouv.fr', 'gouv.fr'], ['x.go.jp', 'go.jp'], ['trust.nhs.uk', 'nhs.uk'], ['handong.edu', 'edu'], ['xxx.lanl.gov', 'gov'], ['army.mil', 'mil'],
      ['scourtapp.nic.in', 'nic.in'], ['sextelefon.edu.pl', 'edu.pl'], ['x.gov.scot', 'gov.scot'],
    ]) {
      assert.equal(eduGovSuffix(PSL, RULES, h), s, h)
    }
  })

  test('not: the .ac and .school top-level domains, go.it (a province), ordinary names, and company-run private suffixes without "gov"', () => {
    for (const h of ['example.ac', 'x.school', 'gorizia.go.it', 'academy.com', 'gov-news.com', 'school.example.co.uk', 'me.go.dyndns.org', 'x.edu.eu.org', 'x.sch.tf', 'a.b.ac.example.dev', 'someone.blogspot.com']) {
      assert.equal(eduGovSuffix(PSL, RULES, h), null, h)
    }
    // A private suffix with a "gov" label is a government service.
    assert.equal(eduGovSuffix(PSL, RULES, 'x.service.gov.uk'), 'service.gov.uk')
    assert.equal(publicSuffixOf(PSL, 'a.b.uos.ac.uk'), 'ac.uk')
    assert.equal(publicSuffixOf(PSL, 'ac.uk'), null)
  })
})

describe('the hold-back in the build', () => {
  const input = (extra: Partial<BuildInput['data']> = {}, patch: Partial<BuildInput> = {}): BuildInput => {
    const b = baseInput()
    return {
      ...b,
      ...patch,
      sources: [...b.sources, { id: 'edu', text: 'uni.ac.uk\nporn.ac.uk\nx.handong.edu\nschool.example.com\n' }],
      psl: SYNTHETIC_PSL.replace('\nco.uk\n', '\nco.uk\nac.uk\nedu\n'), // in the ICANN section
      eduGov: { labels: ['ac', 'edu', 'gov'], tlds: ['edu', 'gov'], extra: [], excluded: [] },
      data: { ...b.data, ...extra },
    }
  }
  const hostsOf = (out: ReturnType<typeof runBuild>): string[] => decodeHayaaList(out.files.get('hayaa-list-2026110101.bin')!).hosts

  test('held back unless reviewed; recorded in the signed build-info.json and counted', () => {
    const out = runBuild(input())
    for (const h of ['uni.ac.uk', 'porn.ac.uk', 'x.handong.edu']) assert.ok(!hostsOf(out).includes(h), h)
    assert.ok(hostsOf(out).includes('school.example.com'))
    assert.deepEqual(out.heldBackEduGov, ['porn.ac.uk', 'uni.ac.uk', 'x.handong.edu'])
    assert.equal(out.report.counts.heldBackEduGov, 3)
    assert.deepEqual(parseBuildInfo(new TextDecoder().decode(out.files.get('build-info.json'))).heldBackEduGov, ['porn.ac.uk', 'uni.ac.uk', 'x.handong.edu'])
    const reviewed = runBuild(input({ reviewedEduGov: 'porn.ac.uk  # explicit name\nhandong.edu  # covers its subdomains\n' }))
    assert.ok(hostsOf(reviewed).includes('porn.ac.uk'))
    assert.ok(hostsOf(reviewed).includes('x.handong.edu'))
    assert.deepEqual(reviewed.heldBackEduGov, ['uni.ac.uk'])
  })

  test('held back even when the previous release listed it (this gate exists to stop blocking schools)', () => {
    const first = runBuild(input())
    const info = parseBuildInfo(new TextDecoder().decode(first.files.get('build-info.json')))
    const prev = { hosts: new Set([...hostsOf(first), 'uni.ac.uk']), info, origin: 'test' }
    const out = runBuild(input({}, { previous: prev, allowShrink: true, allowGrowth: true }))
    assert.ok(!hostsOf(out).includes('uni.ac.uk'))
  })

  test('a reviewed entry needs a reason; one that is not education or government is reported', () => {
    assert.throws(() => runBuild(input({ reviewedEduGov: 'porn.ac.uk\n' })), /has no reason/)
    const out = runBuild(input({ reviewedEduGov: 'adult-one.com  # not edu\n' }))
    assert.ok(out.report.warnings.some((w) => /reviewed-edu-gov: "adult-one.com" is not under an education or government suffix/.test(w)))
  })
})

describe('data/reviewed-edu-gov.txt', () => {
  test('every entry has a reason and an explicit name; the false positives found are not in it', () => {
    const reviewed = parseReasonedHosts(readFileSync(join(__dirname, '..', 'data', 'reviewed-edu-gov.txt'), 'utf8'), 'reviewed-edu-gov', normalizeDomainInput)
    assert.ok(reviewed.size >= 1)
    for (const h of reviewed.keys()) assert.match(h, /porn|sex|xxx/, h)
    for (const h of ['xxx.lanl.gov', 'erapornew2026.smkn6bkl.sch.id', 'rapornew.smkn1mopuya.sch.id', 'jutiporn.ac.th', 'namporn.ac.th', 'sexoffender.ncsbi.gov']) {
      assert.ok(!reviewed.has(h), h)
    }
  })
})
