// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// Text that reaches a GitHub issue from upstream (host names from the source
// lists, error messages and licence values from upstream repositories) is
// untrusted. It is reduced to a small set of safe characters, each line and
// the number of lines are capped, and the whole is put inside a code fence,
// so it can neither render as Markdown, mention a person, nor break out of
// the fence.

/** Characters kept as they are; everything else becomes "?". No backtick. */
const UNSAFE = /[^A-Za-z0-9 .,:;_/()'"=+\-%#@*?![\]<>{}|~&$^]/g
export const MAX_LINE_CHARS = 300
export const MAX_LINES = 200

/** One line of untrusted text, made safe and capped. */
export const sanitizeIssueLine = (raw: string, max = MAX_LINE_CHARS): string => {
  const flat = raw.replace(/\s+/g, ' ').trim().replace(UNSAFE, '?')
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat
}

/** Untrusted lines as one fenced block, at most `maxLines` of them plus a count of the rest. */
export const issueBlock = (lines: readonly string[], maxLines = MAX_LINES): string => {
  const kept = lines.filter((l) => l.trim() !== '').map((l) => sanitizeIssueLine(l))
  const shown = kept.slice(0, maxLines)
  if (kept.length > maxLines) shown.push(`... and ${kept.length - maxLines} more (see the run's artifacts)`)
  return ['```text', ...shown, '```'].join('\n')
}
