/* Re-pin the inputs in sources.lock.json:
 *
 *   npm run update-lock
 *   npm run update-lock -- --accept-license-change
 *   npm run update-lock -- --fallback-lock previous/sources.lock.json --notes lock-notes.txt
 *
 * Every source that is not frozen moves to the newest commit of its branch
 * (raw URL at that commit, SHA-256 of the file), and so does the Public
 * Suffix List. The Tranco list moves only to the ID set in src/config.ts.
 *
 * Fail-safe: a source whose repository or file is gone, or whose licence
 * file changed, keeps its previous pin (from --fallback-lock, the lock of the
 * previous release, when given) and a line is written to --notes; the job
 * opens an issue from it and still releases. Set GITHUB_TOKEN to avoid the
 * GitHub API's anonymous rate limit.
 */

import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TRANCO_LIST_ID } from '../src/config'
import { httpGet, readLock, writeLock } from '../src/lock'
import { updateLock, type LockNet } from '../src/lock-update'

const LOCK = resolve(__dirname, '..', 'sources.lock.json')

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const githubHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return h
}

const net: LockNet = {
  latestCommit: async (repo, branch) => {
    const body = JSON.parse(new TextDecoder().decode(await httpGet(`https://api.github.com/repos/${repo}/commits/${branch}`, githubHeaders()))) as {
      sha?: unknown
    }
    if (typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.sha)) throw new Error(`${repo}: no commit SHA in the API answer`)
    return body.sha
  },
  get: (url) => httpGet(url),
}

const main = async (): Promise<void> => {
  const fallbackPath = arg('--fallback-lock')
  const notesPath = arg('--notes')
  const fallback = fallbackPath && existsSync(fallbackPath) ? readLock(resolve(fallbackPath)) : null
  const current = readLock(LOCK)
  const result = await updateLock(current, net, {
    acceptLicenseChange: process.argv.includes('--accept-license-change'),
    fallback,
    trancoListId: TRANCO_LIST_ID,
  })
  for (const line of result.log) console.log(line)
  writeLock(LOCK, result.lock)
  readLock(LOCK) // the written lock must pass the same checks the build applies
  if (notesPath) writeFileSync(resolve(notesPath), result.notes.map((n) => `- ${n}`).join('\n') + (result.notes.length ? '\n' : ''))
  for (const n of result.notes) console.warn(`NOTE: ${n}`)
  console.log(`\nsources.lock.json updated${result.notes.length ? ` (${result.notes.length} note(s) for review)` : ''}`)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
