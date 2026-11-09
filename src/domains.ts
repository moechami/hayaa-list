// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// Host normalization, identical to the Hayaa app's normalizeDomainInput
// (lib/blocker/domains.ts), which mirrors DomainMatcher.normalize in Kotlin.
// List entries and user-typed domains go through ONE definition of "a host",
// so a site the app normalizes one way is never listed another way. The one
// addition is the 253-character cap below, which only refuses names that
// cannot exist in DNS.

import punycode from 'punycode/'

/** The longest hostname DNS allows (RFC 1035 section 2.3.4, without the trailing dot). */
export const MAX_HOST_CHARS = 253

/**
 * Normalize a list entry or a pasted URL ("https://www.Example.com/path?q=1")
 * into a bare lowercase ASCII host ("example.com"), or null when it cannot be
 * one.
 *
 * A leading "www." is stripped: listing "www.example.com" but not
 * "example.com" would be a bypass, and the parent walk at lookup time
 * re-covers www itself.
 */
export const normalizeDomainInput = (raw: string): string | null => {
  let value = raw.trim().toLowerCase()
  if (value === '') return null
  // Strip scheme, path/query/fragment, credentials and port.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const slash = value.search(/[/?#]/)
  if (slash !== -1) value = value.slice(0, slash)
  const at = value.lastIndexOf('@')
  if (at !== -1) value = value.slice(at + 1)
  const colon = value.indexOf(':')
  if (colon !== -1) value = value.slice(0, colon)
  if (value.endsWith('.')) value = value.slice(0, -1)
  // Browsers show Unicode hosts; the ASCII (punycode) form is what the
  // matcher compares. Same order as the app: trailing dot, IDN, www.
  try {
    value = punycode.toASCII(value.normalize('NFC')).toLowerCase()
  } catch {
    return null
  }
  if (value.startsWith('www.')) value = value.slice(4)
  // A DNS name is at most 253 characters. Checked here (one addition to the
  // app's rules) so one over-long upstream line is skipped like any other
  // malformed line instead of reaching the list writer, whose keys stop at
  // 255 bytes.
  if (value.length > MAX_HOST_CHARS) return null
  // Structural validation: at least two labels, each 1-63 chars of
  // letter/digit/hyphen, not hyphen-edged.
  const labels = value.split('.')
  if (labels.length < 2) return null
  const labelOk = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
  if (!labels.every((l) => labelOk.test(l))) return null
  return value
}
