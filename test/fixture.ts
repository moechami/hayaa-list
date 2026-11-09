// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// The shared cross-language fixture, identical to the Hayaa app's
// (tools/blocklist-build/build.ts there). The committed files in
// test/fixtures/ are copies of the app's src/test/resources/ fixtures, which
// the app's Kotlin and TypeScript readers both assert against; format.test.ts
// checks this writer reproduces them byte for byte.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileHayaaList } from '../src/format'

export const FIXTURE_HOSTS: readonly string[] = [
  'example.com',
  'sub.other.net',
  'blocked.co.uk',
  'a.b.c.d.org',
  'zzz.top',
  'alpha.example.org',
  'beta.example.org',
  'gamma.example.org',
  'one.two.three.info',
  'last.xyz',
]
export const FIXTURE_BLOCK_SIZE = 48

export const FIXTURE_PATHS: readonly string[] = [
  'reddit.com/r/nsfw', // 2 segments
  'imgur.com/a', // 1 segment
  'tumblr.com/tagged/x/y', // 3 segments
  'other.net/gallery', // sorts right after the listed host key "net.other.sub"
  'www.example.com/some/page', // dropped: its parent example.com is a listed host
  'reddit.com/r/nsfw/top', // dropped: reddit.com/r/nsfw already covers it
]
export const FIXTURE_SERIAL = 2026110101

export const compileFixtureV2 = (): Uint8Array =>
  compileHayaaList({ hosts: FIXTURE_HOSTS, paths: FIXTURE_PATHS, serial: FIXTURE_SERIAL, blockSize: FIXTURE_BLOCK_SIZE }).bytes

export const committed = (name: string): Uint8Array => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)))
