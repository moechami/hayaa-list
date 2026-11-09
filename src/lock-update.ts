// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// Re-pinning sources.lock.json, without I/O of its own (the network is passed
// in, so the tests run it offline). Fail-safe by design: one source that
// disappears, whose licence changes, or whose repository is no longer the
// same repository (another numeric id or name: renamed, redirected, or
// deleted and recreated), keeps its previous pin and produces a note for a
// person; the other sources still update and the release still ships. Only
// the Tranco list, which the maintainer pins by hand in src/config.ts, is
// fatal when it cannot be fetched.

import { createHash } from 'node:crypto'
import { rawUrl, trancoUrl, type Lock, type PinnedSource } from './lock'

export type RepoInfo = { id: number; fullName: string }

export type LockNet = {
  /** GitHub's id and canonical owner/name for `repo` (GET /repos/{owner}/{repo}); throws when it is gone. */
  repoInfo(repo: string): Promise<RepoInfo>
  /** Newest commit SHA of `branch`; throws when the repository or branch is gone. */
  latestCommit(repo: string, branch: string): Promise<string>
  /** Bytes at `url`; throws on any non-2xx answer. */
  get(url: string): Promise<Uint8Array>
}

export type LockUpdate = {
  lock: Lock
  /** Things a person must look at (an issue is opened for them); the release still ships. */
  notes: string[]
  /** One line per input, for the log. */
  log: string[]
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const pinFields = (s: PinnedSource): Pick<PinnedSource, 'commit' | 'url' | 'sha256' | 'licenseSha256'> => ({
  commit: s.commit,
  url: s.url,
  sha256: s.sha256,
  licenseSha256: s.licenseSha256,
})

/** Null when `info` is still the pinned repository, else what changed. */
export const repoIdentityProblem = (repo: string, repoId: number, info: RepoInfo): string | null => {
  if (info.id !== repoId) return `repository id is now ${info.id}, pinned ${repoId} (deleted and recreated, or replaced)`
  if (info.fullName.toLowerCase() !== repo.toLowerCase()) return `repository is now ${info.fullName}, pinned ${repo} (renamed or redirected)`
  return null
}

/**
 * Re-pin every non-frozen source and the Public Suffix List to the newest
 * commit, and the Tranco list to `trancoListId`. `fallback` is the lock of
 * the previous release: when a source cannot be re-pinned, its pin there is
 * kept (else the current one). Repository ids come from `current` (the lock
 * on main, reviewed by a person), never from the fallback.
 */
export const updateLock = async (
  current: Lock,
  net: LockNet,
  opts: { acceptLicenseChange: boolean; fallback: Lock | null; trancoListId: string },
): Promise<LockUpdate> => {
  const lock = JSON.parse(JSON.stringify(current)) as Lock
  const notes: string[] = []
  const log: string[] = []

  for (const s of lock.sources) {
    if (s.frozen) {
      log.push(`${s.id}: frozen at ${s.commit.slice(0, 12)}, not re-pinned`)
      continue
    }
    const prev = opts.fallback?.sources.find((p) => p.id === s.id && p.repo === s.repo && p.path === s.path)
    try {
      const identity = repoIdentityProblem(s.repo, s.repoId, await net.repoInfo(s.repo))
      if (identity) {
        if (prev) Object.assign(s, pinFields(prev))
        notes.push(
          `${s.id}: ${identity}. Kept the pin ${s.commit.slice(0, 12)}. ` +
            'Check who now owns the repository before changing repoId in sources.lock.json by hand.',
        )
        log.push(`${s.id}: kept ${s.commit.slice(0, 12)} (repository identity changed)`)
        continue
      }
      const commit = await net.latestCommit(s.repo, s.branch)
      if (commit === s.commit) {
        log.push(`${s.id}: ${commit.slice(0, 12)} (unchanged)`)
        continue
      }
      const bytes = await net.get(rawUrl(s.repo, commit, s.path))
      const licenseSha256 = sha256(await net.get(rawUrl(s.repo, commit, s.licenseFile)))
      const problems: string[] = []
      if (licenseSha256 !== s.licenseSha256 && !opts.acceptLicenseChange) problems.push(`${s.licenseFile} changed`)
      if (s.licenseJson) {
        const j = s.licenseJson
        const doc = JSON.parse(new TextDecoder().decode(await net.get(rawUrl(s.repo, commit, j.file)))) as Record<string, unknown>
        if (doc[j.key] !== j.expected) problems.push(`${j.file} now gives "${j.key}": ${JSON.stringify(doc[j.key])}, not "${j.expected}"`)
      }
      if (problems.length > 0) {
        // The same fallback as every other refusal: the previous release's pin, never a pin only main names.
        if (prev) Object.assign(s, pinFields(prev))
        notes.push(
          `${s.id}: licence check failed at ${commit} (${problems.join('; ')}). Kept the previous pin ${s.commit.slice(0, 12)}. ` +
            'Read the new licence, update CREDITS.md, then run update-lock with --accept-license-change (or update licenseJson.expected).',
        )
        log.push(`${s.id}: kept ${s.commit.slice(0, 12)} (licence check failed)`)
        continue
      }
      Object.assign(s, { commit, url: rawUrl(s.repo, commit, s.path), sha256: sha256(bytes), licenseSha256 })
      log.push(`${s.id}: ${commit.slice(0, 12)} ${bytes.length} bytes`)
    } catch (e) {
      if (prev) Object.assign(s, pinFields(prev))
      notes.push(
        `${s.id}: upstream unavailable (${message(e)}). Kept the pin of the previous release, ${s.commit.slice(0, 12)}. ` +
          'If the source is gone for good, replace or remove it (CREDITS.md, sources.lock.json).',
      )
      log.push(`${s.id}: kept ${s.commit.slice(0, 12)} (upstream unavailable)`)
    }
  }

  const p = lock.publicSuffixList
  const keepPsl = (why: string, note: string): void => {
    const prev = opts.fallback?.publicSuffixList
    if (prev) Object.assign(p, { commit: prev.commit, url: prev.url, sha256: prev.sha256 })
    notes.push(`public suffix list: ${note}. Kept ${p.commit.slice(0, 12)}.`)
    log.push(`public suffix list: kept ${p.commit.slice(0, 12)} (${why})`)
  }
  try {
    const identity = repoIdentityProblem(p.repo, p.repoId, await net.repoInfo(p.repo))
    if (identity) keepPsl('repository identity changed', identity)
    else {
      const commit = await net.latestCommit(p.repo, p.branch)
      if (commit !== p.commit) {
        const url = rawUrl(p.repo, commit, p.path)
        Object.assign(p, { commit, url, sha256: sha256(await net.get(url)) })
      }
      log.push(`public suffix list: ${p.commit.slice(0, 12)}`)
    }
  } catch (e) {
    keepPsl('upstream unavailable', `upstream unavailable (${message(e)})`)
  }

  // Tranco: pinned by hand in src/config.ts. A list ID never changes content,
  // so it is fetched only when the ID changes, and a failure then is fatal.
  const t = lock.tranco
  if (t.listId !== opts.trancoListId) {
    t.listId = opts.trancoListId
    t.url = trancoUrl(t.listId, t.top)
    t.sha256 = sha256(await net.get(t.url))
    log.push(`tranco: switched to list ${t.listId}`)
  } else log.push(`tranco: list ${t.listId} (pinned in src/config.ts)`)

  return { lock, notes, log }
}
