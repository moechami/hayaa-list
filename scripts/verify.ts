/* Verify a release the way the Hayaa app does.
 *
 *   npm run verify [-- --dir dist] [--pub keys/k1.pub.pem]
 *
 * Checks manifest.json.sig against the public key (by default
 * keys/<keyId>.pub.pem, where keyId is the one the manifest names), then the
 * manifest, and, when the .bin.gz it names is in the same folder, the file's
 * sizes, hashes, header, full validation, canaries and negatives. Exit code
 * 1 on any failure.
 *
 * The signature alone can also be checked with OpenSSL:
 *   openssl dgst -sha256 -verify keys/k1.pub.pem -signature manifest.json.sig manifest.json
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkRelease } from '../src/release-check'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const main = (): void => {
  const root = join(__dirname, '..')
  const dir = resolve(arg('--dir') ?? join(root, 'dist'))
  let pubPath = arg('--pub')
  if (!pubPath) {
    // The key named inside the manifest; it is only trusted once the signature verifies with it.
    const keyId = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { keyId?: unknown }).keyId
    if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error('manifest has no valid keyId')
    pubPath = join(root, 'keys', `${keyId}.pub.pem`)
  }
  const result = checkRelease(dir, readFileSync(resolve(pubPath), 'utf8'))
  if (!result.ok) throw new Error(`verification FAILED: ${result.reason}`)
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
