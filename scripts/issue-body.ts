// SPDX-License-Identifier: GPL-3.0-or-later
/* Write the body of the "items to review" issue from the monthly notes.
 *
 *   npm run issue-body -- --notes notes --out notes/issue-body.md
 *
 * Reads <notes>/held-back.txt (entries held back for review) and
 * <notes>/lock.txt (sources kept at an old pin). Both carry text that comes
 * from upstream, so every line goes through src/issue.ts: safe characters
 * only, capped in length and number, inside a code fence. Prints the number
 * of items (0 when there is nothing to report).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { issueBlock } from '../src/issue'

const arg = (name: string): string => {
  const i = process.argv.indexOf(name)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`${name} is required`)
  return v
}

const readLines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '') : [])

const main = (): void => {
  const dir = resolve(arg('--notes'))
  const held = readLines(join(dir, 'held-back.txt'))
  const lock = readLines(join(dir, 'lock.txt'))
  // A line in parentheses only counts entries already reported in earlier months.
  const newHeld = held.filter((l) => !l.startsWith('('))
  const parts: string[] = []
  if (newHeld.length > 0) {
    parts.push(
      '### Held back (not in this release until reviewed)',
      '',
      'Review each into data/reviewed-top-hits.txt, data/reviewed-top-site-subdomains.txt, data/pending-review.txt or data/allowlist.txt.',
      '',
      issueBlock(held),
      '',
    )
  }
  if (lock.length > 0) parts.push('### Sources kept at their previous pin', '', issueBlock(lock), '')
  writeFileSync(resolve(arg('--out')), parts.join('\n'))
  console.log(String(newHeld.length + lock.length))
}

try {
  main()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
}
