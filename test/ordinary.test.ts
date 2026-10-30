// SPDX-License-Identifier: GPL-3.0-or-later
//
// Ordinary names: a host whose name reads as an ordinary business, school,
// sport or gambling site, with no adult-looking word anywhere in it, is
// removed, unless a person reviewed it as adult.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { decodeHayaaList } from '../src/format'
import { runBuild, type BuildInput } from '../src/pipeline'
import { isOrdinaryName, parseOrdinaryRules } from '../src/protected'
import { parsePsl } from '../src/psl'
import { SYNTHETIC_PSL, baseInput } from './synthetic'

const ROOT = join(__dirname, '..')
const psl = parsePsl(SYNTHETIC_PSL.replace('\nco.uk\n', '\nco.uk\nschool\ntech\n'))

describe('the ordinary-name rule', () => {
  const rules = parseOrdinaryRules('ordinary golf\nordinary academ\nordinary casino\nordinary tech\nadult porn\nadult girl\nadult xxx\n')

  test('an ordinary word in the name and no adult-looking word anywhere: removed', () => {
    assert.equal(isOrdinaryName(psl, rules, 'atlantagolfacademy.com'), true)
    assert.equal(isOrdinaryName(psl, rules, 'cdn.wfdahuatech.com'), true)
  })

  test('one adult-looking word anywhere keeps it, the top-level domain included', () => {
    assert.equal(isOrdinaryName(psl, rules, 'casinogirls.com'), false)
    assert.equal(isOrdinaryName(psl, rules, 'golfporn.com'), false)
    assert.equal(isOrdinaryName(psl, rules, 'golf.xxx'), false)
  })

  test('the ordinary word is read in the name only, never the public suffix', () => {
    assert.equal(isOrdinaryName(psl, rules, 'example.tech'), false)
    assert.equal(isOrdinaryName(psl, rules, 'example.school'), false)
    assert.equal(isOrdinaryName(psl, rules, 'tech'), false) // a bare suffix has no name
  })

  test('the rule file is validated', () => {
    assert.throws(() => parseOrdinaryRules('ordinary golf\n'), /at least one ordinary and one adult/)
    assert.throws(() => parseOrdinaryRules('ordinary (\nadult porn\n'), /not a valid regular expression/)
    assert.throws(() => parseOrdinaryRules('ordinary a*\nadult porn\n'), /matches the empty string/)
    assert.throws(() => parseOrdinaryRules('other golf\nadult porn\n'), /must be "ordinary <pattern>"/)
    assert.throws(() => parseOrdinaryRules('ordinary golf club\nadult porn\n'), /must be "ordinary <pattern>"/)
  })
})

describe('the ordinary-name rule in the build', () => {
  const input = (data: Partial<BuildInput['data']> = {}): BuildInput => {
    const b = baseInput()
    return { ...b, sources: [...b.sources, { id: 'o', text: 'atlantagolfacademy.com\ncasinogirls.com\nreviewedgolf.com\n' }], data: { ...b.data, ...data } }
  }
  const hostsOf = (out: ReturnType<typeof runBuild>): string[] => decodeHayaaList(out.files.get('hayaa-list-2026110101.bin')!).hosts

  test('removes ordinary names, keeps adult-looking ones and hosts a person reviewed as adult', () => {
    const out = runBuild(input({ additions: 'reviewedgolf.com\n' }))
    assert.ok(!hostsOf(out).includes('atlantagolfacademy.com'))
    assert.ok(hostsOf(out).includes('casinogirls.com'))
    assert.ok(hostsOf(out).includes('reviewedgolf.com')) // an addition was reviewed by a person
    assert.deepEqual(out.removedOrdinaryNames, ['atlantagolfacademy.com'])
    assert.equal(out.report.counts.ordinaryNamesRemoved, 1)
  })
})

describe('data/ordinary-names.txt', () => {
  const rules = parseOrdinaryRules(readFileSync(join(ROOT, 'data', 'ordinary-names.txt'), 'utf8'))
  const real = parsePsl(SYNTHETIC_PSL)

  test('the ordinary sites found by sampling are removed', () => {
    for (const h of [
      'atlantagolfacademy.com', 'izmitgazetesi.com', 'tlsanitaryware.com', 'xianedutech.com', 'better-business.com', 'holiganbetsresmigiris.com',
      'adriaticbasket.com', 'breamsoft.com', 'standardization.cn', 'members2.boardhost.com', 'ozgekoltuk.com', 'impulsetek.com', 'trends24.info',
      'tedxyouthipoh.com', 'dotnetmaniac.com', 't2racekarts.com', 'yanbinpump.com', 'longxiangcapital.com', 'insta-windows.ru', 'cd-taxi.com',
    ]) {
      assert.equal(isOrdinaryName(real, rules, h), true, h)
    }
  })

  test('names with an adult-looking word stay, even next to an ordinary word', () => {
    for (const h of [
      'pornhub.com', 'casinogirls.com', 'schoolsletjes.nl', 'upskirtschool.com', 'youngharlotsacademy.com', 'realsissyschool.com', 'melonscash.com',
      'acompanhantesuniversitaria.com', 'xena-begleitservice.de', 'gynoclinic.cc', 'coffeebrownghettogaggers.com', 'wanz-factory.com', 'torturegarden.com',
      'motormeisjes.nl', 'activeduty.biz', 'bimbomail.com', 'garden-av.com', 'chicasgolfas.com', 'autobahnfick.de', 'condomcash.com',
    ]) {
      assert.equal(isOrdinaryName(real, rules, h), false, h)
    }
  })

  test('the canaries are never ordinary', () => {
    for (const line of readFileSync(join(ROOT, 'data', 'canaries.txt'), 'utf8').split(/\r?\n/)) {
      const host = line.split('#', 1)[0].trim().split(/\s+/)[0]
      if (host) assert.equal(isOrdinaryName(real, rules, host), false, host)
    }
  })
})
