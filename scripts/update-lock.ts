/* Re-pin every input in sources.lock.json to its latest version:
 *
 *   npm run update-lock                          # sources, Public Suffix List, latest Tranco list
 *   npm run update-lock -- --accept-license-change
 *
 * For each source: the newest commit on its branch, the raw URL at that
 * commit and the SHA-256 of the file. The licence file is fetched at the new
 * commit too; if its hash changed, this stops (exit 1) so a person reads the
 * new licence before it is accepted. Set GITHUB_TOKEN to avoid the GitHub
 * API's anonymous rate limit.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { httpGet, rawUrl, readLock, trancoUrl, writeLock, type Lock } from '../src/lock'

const LOCK = resolve(__dirname, '..', 'sources.lock.json')
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

const githubHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return h
}

const latestCommit = async (repo: string, branch: string): Promise<string> => {
  const body = JSON.parse(new TextDecoder().decode(await httpGet(`https://api.github.com/repos/${repo}/commits/${branch}`, githubHeaders()))) as {
    sha?: unknown
  }
  if (typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.sha)) throw new Error(`${repo}: no commit SHA in the API answer`)
  return body.sha
}

const main = async (): Promise<void> => {
  const acceptLicenseChange = process.argv.includes('--accept-license-change')
  const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as Lock
  const licenseChanges: string[] = []

  for (const s of lock.sources) {
    const commit = await latestCommit(s.repo, s.branch)
    const url = rawUrl(s.repo, commit, s.path)
    const bytes = await httpGet(url)
    const licenseHash = sha256(await httpGet(rawUrl(s.repo, commit, s.licenseFile)))
    if (s.licenseSha256 && s.licenseSha256 !== licenseHash) licenseChanges.push(`${s.id}: ${s.licenseFile} changed at ${commit}`)
    const changed = s.sha256 !== sha256(bytes)
    Object.assign(s, { commit, url, sha256: sha256(bytes), licenseSha256: licenseHash })
    console.log(`${s.id}: ${commit.slice(0, 12)} ${bytes.length} bytes${changed ? ' (new content)' : ''}`)
  }

  const p = lock.publicSuffixList
  p.commit = await latestCommit(p.repo, p.branch)
  p.url = rawUrl(p.repo, p.commit, p.path)
  p.sha256 = sha256(await httpGet(p.url))
  console.log(`public suffix list: ${p.commit.slice(0, 12)}`)

  const latest = JSON.parse(new TextDecoder().decode(await httpGet('https://tranco-list.eu/api/lists/date/latest'))) as {
    list_id?: unknown
    available?: unknown
  }
  if (typeof latest.list_id !== 'string' || latest.available !== true) throw new Error('tranco: no available latest list')
  const t = lock.tranco
  t.listId = latest.list_id
  t.url = trancoUrl(t.listId, t.top)
  t.sha256 = sha256(await httpGet(t.url))
  console.log(`tranco: list ${t.listId} (top ${t.top})`)

  if (licenseChanges.length > 0 && !acceptLicenseChange) {
    console.error('\nLicence file changed; read it, update CREDITS.md, then re-run with --accept-license-change:')
    for (const c of licenseChanges) console.error(`  ${c}`)
    process.exitCode = 1
    return
  }
  writeLock(LOCK, lock)
  readLock(LOCK) // the written lock must pass the same checks the build applies
  console.log('\nsources.lock.json updated')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
