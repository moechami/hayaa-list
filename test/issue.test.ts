// SPDX-License-Identifier: GPL-3.0-or-later
//
// Text from upstream that reaches a GitHub issue: safe characters only,
// capped, inside a code fence it cannot break out of.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { issueBody } from '../scripts/issue-body'
import { issueBlock, MAX_LINE_CHARS, sanitizeIssueLine } from '../src/issue'
import { runBuild } from '../src/pipeline'
import { parseBuildInfo, serializeBuildInfo } from '../src/previous'
import { baseInput } from './synthetic'

const tmp = mkdtempSync(join(tmpdir(), 'hayaa-list-issue-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

describe('sanitising upstream text for issues', () => {
  test('host names and ordinary messages pass unchanged', () => {
    assert.equal(sanitizeIssueLine('subdomain of a top site: a-b.example.co.uk'), 'subdomain of a top site: a-b.example.co.uk')
    assert.equal(sanitizeIssueLine('src: upstream unavailable (HTTP 404 for https://x/y). Kept 0123abcd.'), 'src: upstream unavailable (HTTP 404 for https://x/y). Kept 0123abcd.')
  })

  test('backticks, control characters and other unsafe characters become "?"; whitespace collapses', () => {
    assert.equal(sanitizeIssueLine('a`b\u0000c‮d\te\n```'), 'a?b?c?d e ???')
    assert.equal(sanitizeIssueLine('licence "<script>"'), 'licence "<script>"') // inert inside the fence
  })

  test('lines are capped', () => {
    const long = sanitizeIssueLine('x'.repeat(1000))
    assert.equal(long.length, MAX_LINE_CHARS)
    assert.ok(long.endsWith('...'))
  })

  test('the block is one code fence with at most maxLines lines, plus a count', () => {
    const block = issueBlock(['a', '', '``` break out', 'b', 'c'], 2)
    assert.deepEqual(block.split('\n'), ['```text', 'a', '??? break out', '... and 2 more (see the run\'s artifacts)', '```'])
    assert.equal((block.match(/```/g) ?? []).length, 2)
  })
})

describe('scripts/issue-body.ts', () => {
  const run = (files: Record<string, string>, extra: string[] = []): { count: string; body: string } => {
    const dir = mkdtempSync(join(tmp, 'notes-'))
    for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t)
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(__dirname, '..', 'scripts', 'issue-body.ts'), '--notes', dir, '--out', join(dir, 'body.md'), ...extra.map((e) => e.replace('<dir>', dir))], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return { count: r.stdout.trim(), body: readFileSync(join(dir, 'body.md'), 'utf8') }
  }

  test('nothing new: count 0, so no issue is opened', () => {
    assert.equal(run({ 'held-back.txt': '(and 12 entries still waiting from earlier months)\n', 'lock.txt': '' }).count, '0')
  })

  test('new held-back entries and lock notes are fenced and counted', () => {
    const r = run({ 'held-back.txt': 'top site: new.example\n(and 3 entries still waiting)\n', 'lock.txt': '- src: repository id is now 9 `@someone`\n' })
    assert.equal(r.count, '2')
    assert.match(r.body, /```text\ntop site: new\.example\n\(and 3 entries still waiting\)\n```/)
    assert.match(r.body, /- src: repository id is now 9 \?@someone\?/)
  })

  test('the gate overrides from the signed build-info.json are stated; a used one always opens the issue', () => {
    const info = (allowShrink: boolean, allowGrowth: boolean): string =>
      new TextDecoder().decode(serializeBuildInfo({ ...parseBuildInfo(new TextDecoder().decode(runBuild(baseInput()).files.get('build-info.json'))), gateOverrides: { allowShrink, allowGrowth } }))
    const none = run({ 'held-back.txt': '', 'build-info.json': info(false, false) }, ['--build-info', '<dir>/build-info.json'])
    assert.equal(none.count, '0')
    assert.match(none.body, /allow_shrink: no, allow_growth: no/)
    const used = run({ 'held-back.txt': '', 'build-info.json': info(false, true) }, ['--build-info', '<dir>/build-info.json'])
    assert.equal(used.count, '1')
    assert.match(used.body, /allow_shrink: no, allow_growth: yes .* A gate was skipped/)
    assert.deepEqual(issueBody([], [], { allowShrink: true, allowGrowth: true }).count, 1)
    assert.doesNotMatch(issueBody(['top site: a.example'], [], null).body, /Gate overrides/)
  })
})
