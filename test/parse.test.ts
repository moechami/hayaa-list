// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeDomainInput } from '../src/domains'
import { applyAllowlist, applyExactAllowlist, dedupeCoveredHosts, parentDomains, parseList, parseListLine, readDataLines } from '../src/parse'
import { isPublicSuffix, parsePsl, registrableDomain } from '../src/psl'
import { each } from './helpers'
import { SYNTHETIC_PSL } from './synthetic'

describe('normalizeDomainInput (same rules as the app)', () => {
  each(
    'normalizes',
    [
      ['https://www.Example.com/path?q=1', 'example.com'],
      ['user:pw@Example.com:8080', 'example.com'],
      ['example.com.', 'example.com'],
      ['bücher.de', 'xn--bcher-kva.de'],
      ['sub.example.co.uk', 'sub.example.co.uk'],
    ] as const,
    (input, expected) => assert.equal(normalizeDomainInput(input), expected),
  )

  each(
    'refuses',
    [['localhost'], [''], ['-bad.com'], ['bad-.com'], ['a..com'], ['under_score.com'], [`${'x'.repeat(64)}.com`]] as const,
    (input) => assert.equal(normalizeDomainInput(input), null),
  )

  test('hosts longer than 253 characters are refused (DNS limit), 253 is accepted', () => {
    const label = 'a'.repeat(61)
    const at253 = `${'a'.repeat(63)}.${label}.${label}.${label}.com`
    assert.equal(at253.length, 253)
    assert.equal(normalizeDomainInput(at253), at253)
    assert.equal(normalizeDomainInput('b' + at253), null)
    // Counted after "www." is stripped: the stored host is what must fit.
    assert.equal(normalizeDomainInput('www.' + at253), at253)
    // A list line that long is skipped, never thrown on.
    assert.deepEqual(parseList(`0.0.0.0 b${at253}\nok.com\n`), { hosts: new Set(['ok.com']), lines: 2, skipped: 1 })
  })
})

describe('source parsing', () => {
  test('hosts-file and plain lines, comments and noise', () => {
    assert.equal(parseListLine('0.0.0.0 Example.com # note'), 'example.com')
    assert.equal(parseListLine('127.0.0.1 www.example.org'), 'example.org')
    assert.equal(parseListLine('example.net'), 'example.net')
    assert.equal(parseListLine('0.0.0.0 localhost'), null)
    assert.equal(parseListLine('0.0.0.0 0.0.0.0'), null)
    assert.equal(parseListLine('1.2.3.4'), null)
  })

  test('a whole file: unique hosts and a count of skipped lines', () => {
    const { hosts, skipped } = parseList('# header\r\n0.0.0.0 a.com\r\na.com\r\n\r\nbad host!\r\nb.com\n')
    assert.deepEqual([...hosts].sort(), ['a.com', 'b.com'])
    assert.equal(skipped, 1)
  })

  test('parent dedupe keeps only hosts no listed parent covers', () => {
    assert.deepEqual(parentDomains('a.b.c.com'), ['b.c.com', 'c.com'])
    const out = dedupeCoveredHosts(new Set(['example.com', 'a.example.com', 'b.a.example.com', 'other.example.org']))
    assert.deepEqual([...out].sort(), ['example.com', 'other.example.org'])
  })

  test('allowlist: subtree form and exact form', () => {
    const hosts = new Set(['safe.org', 'x.safe.org', 'notsafe.org', 'platform.com', 'site.platform.com'])
    const subtree = applyAllowlist(hosts, ['safe.org'])
    assert.deepEqual([...subtree.hosts].sort(), ['notsafe.org', 'platform.com', 'site.platform.com'])
    assert.equal(subtree.removed, 2)
    const exact = applyExactAllowlist(subtree.hosts, new Set(['platform.com']))
    assert.deepEqual([...exact.hosts].sort(), ['notsafe.org', 'site.platform.com'])
  })

  test('data files: comments and blank lines ignored', () => {
    assert.deepEqual(readDataLines('# head\n\na.com   # why\n  b.com\n'), ['a.com', 'b.com'])
  })
})

describe('Public Suffix List', () => {
  const psl = parsePsl(SYNTHETIC_PSL)

  each(
    'isPublicSuffix',
    [
      ['com', true],
      ['co.uk', true],
      ['blogspot.com', true],
      ['anything.ck', true], // *.ck
      ['www.ck', false], // !www.ck
      ['example.com', false],
      ['example.co.uk', false],
      ['someone.blogspot.com', false],
    ] as const,
    (host, expected) => assert.equal(isPublicSuffix(psl, host), expected),
  )

  each(
    'registrableDomain',
    [
      ['a.b.example.co.uk', 'example.co.uk'],
      ['example.com', 'example.com'],
      ['x.someone.blogspot.com', 'someone.blogspot.com'],
      ['a.www.ck', 'www.ck'],
      ['foo.bar.ck', 'foo.bar.ck'],
      ['co.uk', null],
      ['bar.ck', null],
    ] as const,
    (host, expected) => assert.equal(registrableDomain(psl, host), expected),
  )

  test('a truncated list is refused', () => {
    assert.throws(() => parsePsl('com\nnet\n'), /truncated/)
  })
})
