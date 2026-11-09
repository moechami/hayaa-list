// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// sources.lock.json: the committed lock, and re-pinning it (offline, over a
// fake network): frozen sources stay, a vanished upstream, a changed licence
// or a repository that is no longer the pinned one keeps the previous
// release's pin and leaves a note, the Tranco list follows src/config.ts only.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { TRANCO_LIST_ID } from '../src/config'
import { rawUrl, readLock, trancoUrl, type Lock, type PinnedSource } from '../src/lock'
import { repoIdentityProblem, updateLock, type LockNet, type RepoInfo } from '../src/lock-update'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const C = (n: number): string => String(n).repeat(40).slice(0, 40)

describe('the committed lock', () => {
  const lock = readLock(join(__dirname, '..', 'sources.lock.json'))

  test('passes the build\'s checks and names the Tranco list of src/config.ts', () => {
    assert.equal(lock.tranco.listId, TRANCO_LIST_ID)
    assert.equal(lock.tranco.url, trancoUrl(TRANCO_LIST_ID, 10_000))
  })

  test('The Block List Project is frozen at the exact file the app ships today', () => {
    const blp = lock.sources.find((s) => s.id === 'blocklistproject-porn')!
    assert.equal(blp.frozen, true)
    assert.equal(blp.commit, '4f5fb53d6c5c2ed75d5378cdee12f640b0f6f2c7')
    assert.equal(blp.sha256, '425590c37e3ea624fdf646b14ba661f8b8f38391686adcf02b73f8b2d74b0db1')
    assert.equal(blp.license, 'Unlicense')
  })

  test('every GitHub repository is pinned by its numeric id', () => {
    for (const s of lock.sources) assert.ok(Number.isSafeInteger(s.repoId) && s.repoId > 0, s.id)
    assert.equal(lock.sources.find((s) => s.repo === 'StevenBlack/hosts')?.repoId, 4008931)
    assert.equal(lock.publicSuffixList.repoId, 35890002)
  })

  test('StevenBlack sources pin license.txt and check the extension\'s own licence field', () => {
    for (const s of lock.sources.filter((x) => x.repo === 'StevenBlack/hosts')) {
      assert.equal(s.licenseFile, 'license.txt')
      assert.deepEqual(s.licenseJson, { file: s.path.replace(/hosts$/, 'update.json'), key: 'license', expected: 'MIT' })
    }
  })
})

const source = (id: string, extra: Partial<PinnedSource> = {}): PinnedSource => {
  const s: PinnedSource = {
    id,
    name: id,
    repo: `o/${id}`,
    repoId: 1000 + id.length,
    branch: 'main',
    path: 'list.txt',
    commit: C(1),
    url: rawUrl(`o/${id}`, C(1), 'list.txt'),
    sha256: sha('old list'),
    license: 'MIT',
    licenseFile: 'LICENSE',
    licenseSha256: sha('MIT text'),
    homepage: '',
    attribution: '',
    ...extra,
  }
  return s
}

const baseLock = (sources: PinnedSource[]): Lock => ({
  lockVersion: 1,
  sources,
  publicSuffixList: { repo: 'p/l', repoId: 77, branch: 'main', path: 'psl.dat', commit: C(1), url: rawUrl('p/l', C(1), 'psl.dat'), sha256: sha('psl'), license: 'MPL-2.0', homepage: '' },
  tranco: { listId: 'AAAA', top: 10_000, url: trancoUrl('AAAA', 10_000), sha256: sha('tranco'), homepage: '' },
})

/** Every repo is at commit 2, serving the given files; repos in `gone` fail; `moved` overrides a repository's identity. */
const net = (files: Record<string, string>, gone: string[] = [], moved: Record<string, RepoInfo> = {}): LockNet & { requests: string[] } => {
  const requests: string[] = []
  return {
    requests,
    repoInfo: async (repo) => {
      requests.push(`repo ${repo}`)
      if (gone.includes(repo)) throw new Error('HTTP 404')
      if (repo in moved) return moved[repo]
      return { id: repo === 'p/l' ? 77 : 1000 + repo.slice(2).length, fullName: repo }
    },
    latestCommit: async (repo) => {
      requests.push(`commit ${repo}`)
      if (gone.includes(repo)) throw new Error('HTTP 404')
      return C(2)
    },
    get: async (url) => {
      requests.push(url)
      if (!(url in files)) throw new Error(`HTTP 404 for ${url}`)
      return new TextEncoder().encode(files[url])
    },
  }
}

const opts = { acceptLicenseChange: false, fallback: null, trancoListId: 'AAAA' }

describe('updateLock', () => {
  test('a normal source moves to the newest commit', async () => {
    const files = { [rawUrl('o/a', C(2), 'list.txt')]: 'new list', [rawUrl('o/a', C(2), 'LICENSE')]: 'MIT text', [rawUrl('p/l', C(2), 'psl.dat')]: 'psl2' }
    const r = await updateLock(baseLock([source('a')]), net(files), opts)
    assert.equal(r.lock.sources[0].commit, C(2))
    assert.equal(r.lock.sources[0].sha256, sha('new list'))
    assert.equal(r.lock.publicSuffixList.sha256, sha('psl2'))
    assert.deepEqual(r.notes, [])
  })

  test('a frozen source is never touched, not even looked up', async () => {
    const n = net({})
    const frozen = source('blp', { frozen: true })
    const r = await updateLock(baseLock([frozen]), n, opts)
    assert.deepEqual(r.lock.sources[0], frozen)
    assert.ok(!n.requests.some((x) => x.includes('o/blp')))
  })

  test('a vanished upstream keeps the previous release\'s pin, notes it, and the others still update', async () => {
    const files = { [rawUrl('o/b', C(2), 'list.txt')]: 'b list', [rawUrl('o/b', C(2), 'LICENSE')]: 'MIT text' }
    const current = baseLock([source('a', { commit: C(3), url: rawUrl('o/a', C(3), 'list.txt') }), source('b')])
    const fallback = baseLock([source('a')]) // the previous release pinned commit 1
    const r = await updateLock(current, net(files, ['o/a', 'p/l']), { ...opts, fallback })
    assert.equal(r.lock.sources[0].commit, C(1))
    assert.equal(r.lock.sources[0].url, rawUrl('o/a', C(1), 'list.txt'))
    assert.equal(r.lock.sources[1].commit, C(2))
    assert.match(r.notes[0], /^a: upstream unavailable \(HTTP 404\)\. Kept the pin of the previous release, 111111111111/)
    assert.match(r.notes[1], /^public suffix list: upstream unavailable/)
  })

  test('without a previous release the current pin is kept', async () => {
    const r = await updateLock(baseLock([source('a')]), net({}, ['o/a']), opts)
    assert.equal(r.lock.sources[0].commit, C(1))
    assert.equal(r.notes.length, 2) // the source and the Public Suffix List (file missing)
  })

  test('a file removed upstream (commit found, file gone) also falls back', async () => {
    const r = await updateLock(baseLock([source('a')]), net({}), opts)
    assert.equal(r.lock.sources[0].commit, C(1))
    assert.match(r.notes[0], /upstream unavailable \(HTTP 404 for/)
  })

  test('a changed licence file keeps the old pin with a note, unless accepted', async () => {
    const files = { [rawUrl('o/a', C(2), 'list.txt')]: 'new list', [rawUrl('o/a', C(2), 'LICENSE')]: 'CC BY-NC text', [rawUrl('p/l', C(2), 'psl.dat')]: 'psl2' }
    const kept = await updateLock(baseLock([source('a')]), net(files), opts)
    assert.equal(kept.lock.sources[0].commit, C(1))
    assert.match(kept.notes[0], /licence check failed .*LICENSE changed/)
    const accepted = await updateLock(baseLock([source('a')]), net(files), { ...opts, acceptLicenseChange: true })
    assert.equal(accepted.lock.sources[0].commit, C(2))
    assert.equal(accepted.lock.sources[0].licenseSha256, sha('CC BY-NC text'))
  })

  test('a failed licence check falls back to the previous release\'s pin, like every other refusal', async () => {
    const files = { [rawUrl('o/a', C(4), 'list.txt')]: 'new list', [rawUrl('o/a', C(4), 'LICENSE')]: 'CC BY-NC text', [rawUrl('p/l', C(4), 'psl.dat')]: 'psl4' }
    // main pins commit 3 (never released); the previous release pinned commit 1.
    const current = baseLock([source('a', { commit: C(3), url: rawUrl('o/a', C(3), 'list.txt'), sha256: sha('three'), licenseSha256: sha('MIT text') })])
    const fallback = baseLock([source('a')])
    const n: LockNet = { ...net(files), latestCommit: async () => C(4) }
    const r = await updateLock(current, n, { ...opts, fallback })
    assert.equal(r.lock.sources[0].commit, C(1))
    assert.equal(r.lock.sources[0].url, rawUrl('o/a', C(1), 'list.txt'))
    assert.equal(r.lock.sources[0].sha256, fallback.sources[0].sha256)
    assert.equal(r.lock.sources[0].licenseSha256, fallback.sources[0].licenseSha256)
    assert.match(r.notes[0], /^a: licence check failed at 4{40} \(LICENSE changed\)\. Kept the previous pin 111111111111/)
  })

  test('a licence field in a JSON file must keep its expected value (not overridable)', async () => {
    const s = source('sb', { licenseJson: { file: 'update.json', key: 'license', expected: 'MIT' } })
    const files = (lic: string): Record<string, string> => ({
      [rawUrl('o/sb', C(2), 'list.txt')]: 'list',
      [rawUrl('o/sb', C(2), 'LICENSE')]: 'MIT text',
      [rawUrl('o/sb', C(2), 'update.json')]: JSON.stringify({ license: lic }),
      [rawUrl('p/l', C(2), 'psl.dat')]: 'psl',
    })
    assert.equal((await updateLock(baseLock([s]), net(files('MIT')), opts)).lock.sources[0].commit, C(2))
    const changed = await updateLock(baseLock([s]), net(files('CC BY 4.0')), { ...opts, acceptLicenseChange: true })
    assert.equal(changed.lock.sources[0].commit, C(1))
    assert.match(changed.notes[0], /update.json now gives "license": "CC BY 4.0"/)
  })

  test('Tranco: kept while the ID matches the config, re-pinned when the config changes, fatal if then unreachable', async () => {
    const same = await updateLock(baseLock([]), net({ [rawUrl('p/l', C(2), 'psl.dat')]: 'psl' }), opts)
    assert.equal(same.lock.tranco.listId, 'AAAA')
    const url = trancoUrl('BBBB', 10_000)
    const switched = await updateLock(baseLock([]), net({ [url]: 'new ranking', [rawUrl('p/l', C(2), 'psl.dat')]: 'psl' }), { ...opts, trancoListId: 'BBBB' })
    assert.deepEqual([switched.lock.tranco.listId, switched.lock.tranco.url, switched.lock.tranco.sha256], ['BBBB', url, sha('new ranking')])
    await assert.rejects(updateLock(baseLock([]), net({}), { ...opts, trancoListId: 'BBBB' }), /HTTP 404/)
  })

  test('a repository with another id (recreated) keeps the previous pin and leaves a note; others update', async () => {
    const files = { [rawUrl('o/b', C(2), 'list.txt')]: 'b list', [rawUrl('o/b', C(2), 'LICENSE')]: 'MIT text', [rawUrl('p/l', C(2), 'psl.dat')]: 'psl2' }
    const current = baseLock([source('a', { commit: C(3), url: rawUrl('o/a', C(3), 'list.txt') }), source('b')])
    const fallback = baseLock([source('a')])
    const n = net(files, [], { 'o/a': { id: 999999, fullName: 'o/a' } })
    const r = await updateLock(current, n, { ...opts, fallback })
    assert.equal(r.lock.sources[0].commit, C(1)) // the previous release's pin
    assert.equal(r.lock.sources[0].repoId, 1001) // never taken from upstream
    assert.equal(r.lock.sources[1].commit, C(2))
    assert.match(r.notes[0], /^a: repository id is now 999999, pinned 1001/)
    assert.ok(!n.requests.includes('commit o/a')) // nothing is read from the replaced repository
  })

  test('a renamed or redirected repository is refused the same way', async () => {
    const r = await updateLock(baseLock([source('a')]), net({}, [], { 'o/a': { id: 1001, fullName: 'someone/else' } }), opts)
    assert.equal(r.lock.sources[0].commit, C(1))
    assert.match(r.notes[0], /repository is now someone\/else, pinned o\/a/)
    assert.equal(repoIdentityProblem('O/A', 1001, { id: 1001, fullName: 'o/a' }), null) // case does not matter
  })

  test('the Public Suffix List is pinned by id too', async () => {
    const r = await updateLock(baseLock([]), net({ [rawUrl('p/l', C(2), 'psl.dat')]: 'psl2' }, [], { 'p/l': { id: 5, fullName: 'p/l' } }), opts)
    assert.equal(r.lock.publicSuffixList.commit, C(1))
    assert.match(r.notes[0], /^public suffix list: repository id is now 5, pinned 77/)
  })

  test('a lock without repository ids is refused', () => {
    const lock = JSON.parse(readFileSync(join(__dirname, '..', 'sources.lock.json'), 'utf8')) as Lock
    delete (lock.sources[0] as Partial<PinnedSource>).repoId
    const dir = mkdtempSync(join(tmpdir(), 'hayaa-list-lock-'))
    try {
      writeFileSync(join(dir, 'lock.json'), JSON.stringify(lock))
      assert.throws(() => readLock(join(dir, 'lock.json')), /repoId missing/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the input lock is not modified', async () => {
    const lock = baseLock([source('a')])
    const before = JSON.stringify(lock)
    await updateLock(lock, net({}, ['o/a']), opts)
    assert.equal(JSON.stringify(lock), before)
  })
})
