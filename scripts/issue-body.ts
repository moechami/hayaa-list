// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
/* Write the body of the "items to review" issue from the monthly notes.
 *
 *   npm run issue-body -- --notes notes --out notes/issue-body.md [--build-info dist/build-info.json]
 *
 * Reads <notes>/held-back.txt (entries held back for review) and
 * <notes>/lock.txt (sources kept at an old pin). Both carry text that comes
 * from upstream, so every line goes through src/issue.ts: safe characters
 * only, capped in length and number, inside a code fence. With
 * --build-info, the gate overrides the release was built with are stated
 * too, and an override counts as an item, so the issue is always opened
 * when a gate was skipped. Prints the number of items (0 when there is
 * nothing to report).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { issueBlock } from '../src/issue'
import { parseBuildInfo } from '../src/previous'

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const arg = (name: string): string => {
  const v = argOf(name)
  if (!v) throw new Error(`${name} is required`)
  return v
}

const readLines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '') : [])

export type Overrides = { allowShrink: boolean; allowGrowth: boolean }

/** The issue body and its item count, from the notes and the gate overrides (null when unknown). */
export const issueBody = (held: readonly string[], lock: readonly string[], overrides: Overrides | null): { body: string; count: number } => {
  // A line in parentheses only counts entries already reported in earlier months.
  const newHeld = held.filter((l) => !l.startsWith('('))
  const used = overrides !== null && (overrides.allowShrink || overrides.allowGrowth)
  const parts: string[] = []
  if (overrides !== null) {
    const yes = (b: boolean): string => (b ? 'yes' : 'no')
    parts.push(
      '### Gate overrides',
      '',
      `allow_shrink: ${yes(overrides.allowShrink)}, allow_growth: ${yes(overrides.allowGrowth)} (recorded in the signed build-info.json).` +
        (used ? ' A gate was skipped for this release: check that a person reviewed the change.' : ''),
      '',
    )
  }
  if (newHeld.length > 0) {
    parts.push(
      '### Held back (not in this release until reviewed)',
      '',
      'Review each into data/reviewed-top-hits.txt, data/reviewed-top-site-subdomains.txt, data/reviewed-edu-gov.txt, data/pending-review.txt or data/allowlist.txt.',
      '',
      issueBlock(held),
      '',
    )
  }
  if (lock.length > 0) parts.push('### Sources kept at their previous pin', '', issueBlock(lock), '')
  return { body: parts.join('\n'), count: newHeld.length + lock.length + (used ? 1 : 0) }
}

const main = (): void => {
  const dir = resolve(arg('--notes'))
  const infoPath = argOf('--build-info')
  const overrides = infoPath ? parseBuildInfo(readFileSync(resolve(infoPath), 'utf8')).gateOverrides : null
  const { body, count } = issueBody(readLines(join(dir, 'held-back.txt')), readLines(join(dir, 'lock.txt')), overrides)
  writeFileSync(resolve(arg('--out')), body)
  console.log(String(count))
}

if (require.main === module) {
  try {
    main()
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  }
}
