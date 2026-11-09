// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
/* Download the previous release for the build to compare against.
 *
 *   npm run fetch-previous -- --repo owner/name --out previous
 *
 * Writes the latest release's signed files (manifest.json, the list file
 * it names, build-info.json and sources.lock.json, each with its .sig) into
 * --out, and checks every signature against the public keys in keys/ before
 * anything is used. A repository with no release yet leaves the folder empty
 * (the first release compares against nothing). Any other API failure, a
 * missing file or a signature that does not verify exits 1, so an outage or
 * a tampered release can never be mistaken for "no release".
 * Uses GITHUB_TOKEN when set.
 */

import { join, resolve } from 'node:path'
import { fetchPreviousRelease, readPublicKeys, type FetchLike } from '../src/previous'

const arg = (name: string): string => {
  const i = process.argv.indexOf(name)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`${name} is required`)
  return v
}

const main = async (): Promise<void> => {
  const repo = arg('--repo')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('--repo must be owner/name')
  const keys = readPublicKeys(join(__dirname, '..', 'keys'))
  const tag = await fetchPreviousRelease(repo, resolve(arg('--out')), process.env.GITHUB_TOKEN, fetch as unknown as FetchLike, keys)
  console.log(tag ? `previous release: ${tag} (signatures verified)` : 'no previous release: this build compares against nothing')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
