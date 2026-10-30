// SPDX-License-Identifier: GPL-3.0-or-later
/* Verify a release the way the Hayaa app does.
 *
 *   npm run verify [-- --dir dist] [--pub keys/k1.pub.pem] [--release]
 *
 * Checks manifest.json.sig against the public key (by default
 * keys/<keyId>.pub.pem, where keyId is the one the manifest names), then the
 * manifest, and, when the .bin.gz it names is in the same folder, the file's
 * sizes, hashes, header, full validation, canaries and negatives. Then the
 * signatures of build-info.json and sources.lock.json, which the next build
 * relies on: checked when present, and with --release (the publish job)
 * both files, their signatures and the list file are required. Exit code 1
 * on any failure.
 *
 * The signatures alone can also be checked with OpenSSL:
 *   openssl dgst -sha256 -verify keys/k1.pub.pem -signature manifest.json.sig manifest.json
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertLockPairing, BUILD_INFO, LOCK_FILE, parseBuildInfo } from '../src/previous'
import { checkRelease } from '../src/release-check'
import { verifySignature } from '../src/signing'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const main = (): void => {
  const root = join(__dirname, '..')
  const dir = resolve(arg('--dir') ?? join(root, 'dist'))
  const release = process.argv.includes('--release')
  let pubPath = arg('--pub')
  if (!pubPath) {
    // The key named inside the manifest; it is only trusted once the signature verifies with it.
    const keyId = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { keyId?: unknown }).keyId
    if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error('manifest has no valid keyId')
    pubPath = join(root, 'keys', `${keyId}.pub.pem`)
  }
  const pub = readFileSync(resolve(pubPath), 'utf8')
  const result = checkRelease(dir, pub)
  if (!result.ok) throw new Error(`verification FAILED: ${result.reason}`)
  if (release && !result.checkedFile) throw new Error('verification FAILED: the list file is not in the folder')
  for (const name of ['build-info.json', 'sources.lock.json']) {
    const path = join(dir, name)
    if (!existsSync(path)) {
      if (release) throw new Error(`verification FAILED: ${name} is missing`)
      continue
    }
    if (!existsSync(`${path}.sig`)) {
      if (release) throw new Error(`verification FAILED: ${name}.sig is missing`)
      continue
    }
    if (!verifySignature(new Uint8Array(readFileSync(path)), new Uint8Array(readFileSync(`${path}.sig`)), pub)) {
      throw new Error(`verification FAILED: ${name}.sig does not verify`)
    }
  }
  // build-info.json must describe this list and name this exact lock (both signed, separately).
  if (existsSync(join(dir, BUILD_INFO))) {
    const info = parseBuildInfo(readFileSync(join(dir, BUILD_INFO), 'utf8'))
    if (info.serial !== result.serial) throw new Error(`verification FAILED: ${BUILD_INFO} names serial ${info.serial}, the manifest ${result.serial}`)
    if (release || existsSync(join(dir, LOCK_FILE))) {
      try {
        assertLockPairing(dir, info)
      } catch (e) {
        throw new Error(`verification FAILED: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  console.log(
    `verified: serial ${result.serial}, key ${result.keyId}` + (result.checkedFile ? ', list file checked' : ' (list file not present, not checked)'),
  )
}

try {
  main()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
}
