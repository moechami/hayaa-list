// SPDX-License-Identifier: GPL-3.0-or-later
//
// Every field and cap the app's manifest parser (HayaaListManifest.kt)
// enforces. A manifest validateManifest() refuses would be refused on every
// phone, so the build checks it before publishing.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MAX_GZ_BYTES, MAX_MANIFEST_BYTES, MAX_RAW_BYTES, serializeManifest, validateManifest, type Manifest } from '../src/manifest'
import { bytesOf, each } from './helpers'

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)

const valid = (): Manifest => ({
  format: 2,
  serial: 2026110102,
  keyId: 'k1',
  file: { name: 'hayaa-list-2026110102.bin.gz', size: 7864320, sha256: H1, gzSize: 3145728, gzSha256: H2 },
  hostCount: 512345,
  canaries: [{ host: 'example.com', path: '/x' }],
  negatives: [{ host: 'wikipedia.org' }],
})

/** Serialize any object canonically (2-space JSON plus newline), bypassing the typed writer. */
const raw = (o: unknown): Uint8Array => bytesOf(JSON.stringify(o, null, 2) + '\n')

const mutate = (f: (m: Record<string, any>) => void): Uint8Array => {
  const m = JSON.parse(JSON.stringify(valid())) as Record<string, any>
  f(m)
  return raw(m)
}

describe('manifest schema', () => {
  test('the typed writer produces a valid manifest with a fixed key order', () => {
    const bytes = serializeManifest(valid())
    assert.equal(validateManifest(bytes), null)
    const text = new TextDecoder().decode(bytes)
    assert.ok(text.endsWith('}\n'))
    assert.deepEqual(Object.keys(JSON.parse(text)), ['format', 'serial', 'keyId', 'file', 'hostCount', 'canaries', 'negatives'])
    assert.deepEqual(Object.keys(JSON.parse(text).file), ['name', 'size', 'sha256', 'gzSize', 'gzSha256'])
  })

  test('negatives are optional; probe paths are optional', () => {
    assert.equal(validateManifest(serializeManifest({ ...valid(), negatives: undefined, canaries: [{ host: 'example.com' }] })), null)
    assert.equal(validateManifest(serializeManifest({ ...valid(), negatives: [] })), null)
  })

  test('boundary values the app accepts', () => {
    assert.equal(validateManifest(mutate((m) => ((m.serial = 4294967295), (m.file.name = 'hayaa-list-4294967295.bin.gz')))), null)
    assert.equal(validateManifest(mutate((m) => (m.file.size = 32))), null)
    assert.equal(validateManifest(mutate((m) => (m.file.size = MAX_RAW_BYTES))), null)
    assert.equal(validateManifest(mutate((m) => (m.file.gzSize = MAX_GZ_BYTES))), null)
    assert.equal(validateManifest(mutate((m) => (m.hostCount = 0))), null)
    assert.equal(validateManifest(mutate((m) => (m.keyId = 'A_b-9'.padEnd(32, 'x')))), null)
    assert.equal(validateManifest(mutate((m) => (m.file.sha256 = H1.toUpperCase()))), null) // the app lowercases
    assert.equal(validateManifest(mutate((m) => (m.canaries = Array.from({ length: 20 }, () => ({ host: 'a.com' }))))), null)
    assert.equal(validateManifest(mutate((m) => (m.canaries[0].host = 'h'.repeat(253)))), null)
    assert.equal(validateManifest(mutate((m) => (m.canaries[0].path = '/'.repeat(512)))), null)
    assert.equal(validateManifest(mutate((m) => (m.extraField = 'ignored'))), null) // unknown fields are ignored
  })

  each(
    'refuses',
    [
      ['format 3', (m: Record<string, any>) => (m.format = 3), /format/],
      ['format as a string', (m: Record<string, any>) => (m.format = '2'), /format/],
      ['serial 0', (m: Record<string, any>) => (m.serial = 0), /serial/],
      ['serial above u32', (m: Record<string, any>) => (m.serial = 4294967296), /serial/],
      ['serial as a string', (m: Record<string, any>) => (m.serial = '2026110102'), /serial/],
      ['missing keyId', (m: Record<string, any>) => delete m.keyId, /keyId/],
      ['keyId with a space', (m: Record<string, any>) => (m.keyId = 'k 1'), /keyId/],
      ['keyId of 33 chars', (m: Record<string, any>) => (m.keyId = 'k'.repeat(33)), /keyId/],
      ['missing file', (m: Record<string, any>) => delete m.file, /file missing/],
      ['file name of another serial', (m: Record<string, any>) => (m.file.name = 'hayaa-list-2026110101.bin.gz'), /file.name/],
      ['file name with a path', (m: Record<string, any>) => (m.file.name = '../hayaa-list-2026110102.bin.gz'), /file.name/],
      ['size below a header', (m: Record<string, any>) => (m.file.size = 31), /file.size/],
      ['size above 96 MiB', (m: Record<string, any>) => (m.file.size = MAX_RAW_BYTES + 1), /file.size/],
      ['gzSize 0', (m: Record<string, any>) => (m.file.gzSize = 0), /gzSize/],
      ['gzSize above 40 MiB', (m: Record<string, any>) => (m.file.gzSize = MAX_GZ_BYTES + 1), /gzSize/],
      ['short sha256', (m: Record<string, any>) => (m.file.sha256 = 'a'.repeat(63)), /file.sha256/],
      ['non-hex gzSha256', (m: Record<string, any>) => (m.file.gzSha256 = 'g'.repeat(64)), /gzSha256/],
      ['negative hostCount', (m: Record<string, any>) => (m.hostCount = -1), /hostCount/],
      ['hostCount above u32', (m: Record<string, any>) => (m.hostCount = 4294967296), /hostCount/],
      ['no canaries', (m: Record<string, any>) => (m.canaries = []), /at least one/],
      ['missing canaries', (m: Record<string, any>) => delete m.canaries, /canaries/],
      ['21 canaries', (m: Record<string, any>) => (m.canaries = Array.from({ length: 21 }, () => ({ host: 'a.com' }))), /more than 20/],
      ['21 negatives', (m: Record<string, any>) => (m.negatives = Array.from({ length: 21 }, () => ({ host: 'a.com' }))), /more than 20/],
      ['negatives not an array', (m: Record<string, any>) => (m.negatives = { host: 'a.com' }), /negatives/],
      ['empty probe host', (m: Record<string, any>) => (m.canaries[0].host = ''), /host out of range/],
      ['probe host of 254 chars', (m: Record<string, any>) => (m.canaries[0].host = 'h'.repeat(254)), /host out of range/],
      ['probe path null', (m: Record<string, any>) => (m.canaries[0].path = null), /path must be a string/],
      ['probe path of 513 chars', (m: Record<string, any>) => (m.canaries[0].path = '/'.repeat(513)), /path too long/],
      ['probe not an object', (m: Record<string, any>) => (m.negatives = ['wikipedia.org']), /must be an object/],
    ] as [string, (m: Record<string, any>) => void, RegExp][],
    (_name, f, reason) => {
      const problem = validateManifest(mutate(f))
      assert.ok(problem !== null, 'expected a refusal')
      assert.match(problem, reason)
    },
  )

  test('refuses bytes that are not one canonical UTF-8 JSON object', () => {
    assert.match(validateManifest(new Uint8Array([0x7b, 0xff, 0x7d]))!, /UTF-8/)
    assert.match(validateManifest(bytesOf('not json'))!, /not JSON/)
    assert.match(validateManifest(bytesOf('[]\n'))!, /not an object/)
    const text = new TextDecoder().decode(serializeManifest(valid()))
    assert.match(validateManifest(bytesOf(text.replace('"keyId": "k1",', '"keyId": "k1",\n  "keyId": "k2",')))!, /canonical/) // duplicate key
    assert.match(validateManifest(bytesOf(text.trimEnd()))!, /canonical/)
    assert.match(validateManifest(bytesOf(text.replace('"format": 2', '"format": 2.0')))!, /canonical/)
  })

  test('refuses a manifest over 16 KiB', () => {
    const big = mutate((m) => (m.padding = 'x'.repeat(MAX_MANIFEST_BYTES)))
    assert.match(validateManifest(big)!, /16 KiB/)
  })
})
