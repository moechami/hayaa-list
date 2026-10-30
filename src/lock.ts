// SPDX-License-Identifier: GPL-3.0-or-later
//
// sources.lock.json: every input of the build, pinned. Sources and the Public
// Suffix List are pinned to an immutable commit (raw.githubusercontent.com
// URL with the commit SHA) plus the SHA-256 of the file; the top-sites list
// is pinned by its permanent Tranco list ID plus SHA-256. A build fetches
// exactly these bytes or fails.
//
// Each GitHub repository is also pinned by its numeric id (GET
// /repos/{owner}/{repo}). A repository that is renamed, redirected, or
// deleted and recreated under the same name by someone else gets another id
// or name, and the monthly re-pin then keeps the last pin and opens an issue
// instead of following it.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type PinnedSource = {
  id: string
  name: string
  repo: string
  /** GitHub's numeric id of `repo`; a re-pin is refused when it changes. */
  repoId: number
  branch: string
  path: string
  commit: string
  url: string
  sha256: string
  license: string
  /** File in the same repository whose text grants the licence; its hash is pinned so a change stops the monthly job. */
  licenseFile: string
  licenseSha256: string
  homepage: string
  attribution: string
  /**
   * A frozen source is never re-pinned: its repository is archived, so the
   * pinned commit is the final version. update-lock leaves it untouched.
   */
  frozen?: boolean
  /**
   * A JSON file in the same repository that states the licence of this one
   * file, checked at every re-pin: `key` must still equal `expected`.
   */
  licenseJson?: { file: string; key: string; expected: string }
}

export type Lock = {
  lockVersion: 1
  sources: PinnedSource[]
  publicSuffixList: { repo: string; repoId: number; branch: string; path: string; commit: string; url: string; sha256: string; license: string; homepage: string }
  tranco: { listId: string; top: number; url: string; sha256: string; homepage: string }
}

export const rawUrl = (repo: string, commit: string, path: string): string =>
  `https://raw.githubusercontent.com/${repo}/${commit}/${path}`

export const trancoUrl = (listId: string, top: number): string => `https://tranco-list.eu/download/${listId}/${top}`

const SHA1 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/

/** Read and sanity-check the lock: every URL must be the pinned form of its commit or list ID. */
export const readLock = (path: string): Lock => {
  const lock = JSON.parse(readFileSync(path, 'utf8')) as Lock
  if (lock.lockVersion !== 1) throw new Error('unknown lockVersion')
  const ids = new Set<string>()
  for (const s of lock.sources) {
    if (ids.has(s.id)) throw new Error(`duplicate source id ${s.id}`)
    ids.add(s.id)
    if (!SHA1.test(s.commit) || !HEX64.test(s.sha256) || !HEX64.test(s.licenseSha256)) throw new Error(`${s.id}: commit or hash missing`)
    if (s.url !== rawUrl(s.repo, s.commit, s.path)) throw new Error(`${s.id}: url is not pinned to its commit`)
    if (s.frozen !== undefined && typeof s.frozen !== 'boolean') throw new Error(`${s.id}: frozen must be true or false`)
    if (!Number.isSafeInteger(s.repoId) || s.repoId <= 0) throw new Error(`${s.id}: repoId missing`)
    const j = s.licenseJson
    if (j !== undefined && (typeof j.file !== 'string' || typeof j.key !== 'string' || typeof j.expected !== 'string')) {
      throw new Error(`${s.id}: licenseJson needs file, key and expected`)
    }
  }
  const p = lock.publicSuffixList
  if (!SHA1.test(p.commit) || !HEX64.test(p.sha256) || p.url !== rawUrl(p.repo, p.commit, p.path)) throw new Error('publicSuffixList: not pinned')
  if (!Number.isSafeInteger(p.repoId) || p.repoId <= 0) throw new Error('publicSuffixList: repoId missing')
  const t = lock.tranco
  if (!/^[A-Z0-9]{4,8}$/.test(t.listId) || !HEX64.test(t.sha256) || t.url !== trancoUrl(t.listId, t.top)) throw new Error('tranco: not pinned')
  return lock
}

export const writeLock = (path: string, lock: Lock): void => writeFileSync(path, JSON.stringify(lock, null, 2) + '\n')

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** GET with a few retries; throws on a non-2xx answer. */
export const httpGet = async (url: string, headers: Record<string, string> = {}): Promise<Uint8Array> => {
  let last: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'hayaa-list-build', ...headers } })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/**
 * The bytes at `url`, which must hash to `expected`. Cached under `cacheDir`
 * by hash, so a second build reads the same bytes without the network.
 */
export const fetchPinned = async (url: string, expected: string, cacheDir: string): Promise<Uint8Array> => {
  const cached = join(cacheDir, expected)
  if (existsSync(cached)) {
    const bytes = new Uint8Array(readFileSync(cached))
    if (sha256(bytes) === expected) return bytes
  }
  const bytes = await httpGet(url)
  const got = sha256(bytes)
  if (got !== expected) throw new Error(`hash mismatch for ${url}: expected ${expected}, got ${got}`)
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cached, bytes)
  return bytes
}
