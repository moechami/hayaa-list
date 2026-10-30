// Manifest signing and the full release check. Keys are generated per run
// and never written into the repository.

import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { runBuild } from '../src/pipeline'
import { checkRelease } from '../src/release-check'
import { publicKeyPemOf, signManifest, verifyManifest } from '../src/signing'
import { bytesOf } from './helpers'
import { baseInput } from './synthetic'

const keyPair = (namedCurve = 'prime256v1'): { priv: string; pub: string } => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve })
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'hayaa-list-test-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const hasOpenssl = spawnSync('openssl', ['version']).status === 0

describe('signatures', () => {
  const k = keyPair()
  const other = keyPair()
  const manifest = bytesOf('{\n  "format": 2\n}\n')

  test('sign then verify; DER ECDSA (an ASN.1 SEQUENCE of two INTEGERs)', () => {
    const sig = signManifest(manifest, k.priv)
    assert.equal(sig[0], 0x30)
    assert.equal(sig[1], sig.length - 2)
    assert.ok(sig.length >= 8 && sig.length <= 72)
    assert.equal(verifyManifest(manifest, sig, k.pub), true)
    assert.equal(publicKeyPemOf(k.priv), k.pub)
  })

  test('a changed byte, another key or a damaged signature fails', () => {
    const sig = signManifest(manifest, k.priv)
    assert.equal(verifyManifest(bytesOf('{\n  "format": 3\n}\n'), sig, k.pub), false)
    assert.equal(verifyManifest(manifest, sig, other.pub), false)
    const bad = sig.slice()
    bad[bad.length - 1] ^= 1
    assert.equal(verifyManifest(manifest, bad, k.pub), false)
    assert.equal(verifyManifest(manifest, new Uint8Array(0), k.pub), false)
    assert.equal(verifyManifest(manifest, new Uint8Array(513), k.pub), false)
  })

  test('only P-256 keys are accepted', () => {
    const p384 = keyPair('secp384r1')
    assert.throws(() => signManifest(manifest, p384.priv), /P-256/)
    assert.equal(verifyManifest(manifest, signManifest(manifest, k.priv), p384.pub), false)
  })

  test('interoperates with openssl dgst -sha256 in both directions', { skip: !hasOpenssl && 'openssl not installed' }, () => {
    const dir = mkdtempSync(join(tmp, 'ossl-'))
    writeFileSync(join(dir, 'key.pem'), k.priv)
    writeFileSync(join(dir, 'pub.pem'), k.pub)
    writeFileSync(join(dir, 'manifest.json'), manifest)
    // ours → openssl
    writeFileSync(join(dir, 'ours.sig'), signManifest(manifest, k.priv))
    const v = spawnSync('openssl', ['dgst', '-sha256', '-verify', join(dir, 'pub.pem'), '-signature', join(dir, 'ours.sig'), join(dir, 'manifest.json')])
    assert.equal(v.status, 0, v.stderr.toString())
    // openssl → ours
    const s = spawnSync('openssl', ['dgst', '-sha256', '-sign', join(dir, 'key.pem'), '-out', join(dir, 'theirs.sig'), join(dir, 'manifest.json')])
    assert.equal(s.status, 0, s.stderr.toString())
    assert.equal(verifyManifest(manifest, new Uint8Array(readFileSync(join(dir, 'theirs.sig'))), k.pub), true)
  })
})

describe('release check (what the phone verifies)', () => {
  const k = keyPair()
  const out = runBuild(baseInput())
  const dir = mkdtempSync(join(tmp, 'release-'))
  for (const [name, bytes] of out.files) writeFileSync(join(dir, name), bytes)
  const manifest = out.files.get('manifest.json')!
  writeFileSync(join(dir, 'manifest.json.sig'), signManifest(manifest, k.priv))

  test('a signed build passes', () => {
    assert.deepEqual(checkRelease(dir, k.pub), { ok: true, serial: 2026110101, keyId: 'k1', checkedFile: true })
  })

  test('the wrong public key fails before the manifest is read', () => {
    assert.deepEqual(checkRelease(dir, keyPair().pub), { ok: false, reason: 'signature does not verify' })
  })

  test('a list file that differs from the manifest fails', () => {
    const bad = mkdtempSync(join(tmp, 'bad-'))
    for (const name of ['manifest.json', 'manifest.json.sig']) copyFileSync(join(dir, name), join(bad, name))
    const gzName = 'hayaa-list-2026110101.bin.gz'
    const gz = new Uint8Array(readFileSync(join(dir, gzName)))
    gz[gz.length - 9] ^= 1
    writeFileSync(join(bad, gzName), gz)
    const r = checkRelease(bad, k.pub)
    assert.equal(r.ok, false)
  })

  test('without the list file only the signature and manifest are checked', () => {
    const only = mkdtempSync(join(tmp, 'only-'))
    for (const name of ['manifest.json', 'manifest.json.sig']) copyFileSync(join(dir, name), join(only, name))
    assert.deepEqual(checkRelease(only, k.pub), { ok: true, serial: 2026110101, keyId: 'k1', checkedFile: false })
  })
})
