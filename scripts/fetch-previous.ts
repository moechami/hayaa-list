/* Download the previous release for the build to compare against.
 *
 *   npm run fetch-previous -- --repo owner/name --out previous
 *
 * Writes the latest release's hayaa-list-<serial>.txt, build-info.json and
 * sources.lock.json into --out. A repository with no release yet leaves the
 * folder empty (the first release compares against nothing). Any other API
 * failure exits 1, so an outage can never be mistaken for "no release".
 * Uses GITHUB_TOKEN when set.
 */

import { resolve } from 'node:path'
import { fetchPreviousRelease, type FetchLike } from '../src/previous'

const arg = (name: string): string => {
  const i = process.argv.indexOf(name)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`${name} is required`)
  return v
}

const main = async (): Promise<void> => {
  const repo = arg('--repo')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('--repo must be owner/name')
  const tag = await fetchPreviousRelease(repo, resolve(arg('--out')), process.env.GITHUB_TOKEN, fetch as unknown as FetchLike)
  console.log(tag ? `previous release: ${tag}` : 'no previous release: this build compares against nothing')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
