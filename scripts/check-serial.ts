// SPDX-License-Identifier: GPL-3.0-or-later
/* The serial about to be released must be newer than every existing release.
 *
 *   npm run check-serial -- --repo owner/name --serial 2026110101
 *
 * Lists every release (drafts included). A repository with no release passes;
 * any API error fails (exit 1) rather than passing a serial nobody checked.
 * Uses GITHUB_TOKEN when set.
 */

import { releaseSerials, type FetchLike } from '../src/previous'

const arg = (name: string): string => {
  const i = process.argv.indexOf(name)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`${name} is required`)
  return v
}

/** Null when `serial` may be released after `existing`, else the reason. */
export const serialProblem = (serial: string, existing: readonly number[]): string | null => {
  if (!/^[0-9]{10}$/.test(serial) || Number(serial) > 0xffffffff) return `bad serial ${serial}`
  const newest = existing.length ? Math.max(...existing) : null
  if (newest !== null && Number(serial) <= newest) return `serial ${serial} is not newer than the latest release v${newest}`
  return null
}

const main = async (): Promise<void> => {
  const repo = arg('--repo')
  const serial = arg('--serial')
  const existing = await releaseSerials(repo, process.env.GITHUB_TOKEN, fetch as unknown as FetchLike)
  const problem = serialProblem(serial, existing)
  if (problem) throw new Error(problem)
  console.log(`serial ${serial} is newer than ${existing.length ? `v${Math.max(...existing)}` : 'any release (there are none yet)'}`)
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
}
