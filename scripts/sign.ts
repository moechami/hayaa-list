/* Sign a built manifest.
 *
 *   LIST_SIGNING_KEY="$(cat key.pem)" npm run sign [-- --dir dist]
 *
 * Reads the EC P-256 private key (PEM) from the LIST_SIGNING_KEY environment
 * variable, never from a file in the repository, and writes
 * <dir>/manifest.json.sig: a DER ECDSA signature over SHA-256 of the exact
 * bytes of <dir>/manifest.json. The same result as
 *   openssl dgst -sha256 -sign key.pem -out manifest.json.sig manifest.json
 *
 * FOR LOCAL USE ONLY (a trial release with a throwaway key). The release
 * workflow does not use this script: it signs with OpenSSL, reading the key
 * from the environment through process substitution so it never touches the
 * disk, then verifies with both OpenSSL and the Node verifier. Never put the
 * production key in a file or a shell history to run this.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { signManifest } from '../src/signing'

const main = (): void => {
  console.warn('warning: local signing only; releases are signed by the workflow with OpenSSL (see keys/README.md)')
  const i = process.argv.indexOf('--dir')
  const dir = resolve(i >= 0 ? (process.argv[i + 1] ?? '') : join(__dirname, '..', 'dist'))
  const pem = process.env.LIST_SIGNING_KEY
  if (!pem || !pem.includes('PRIVATE KEY')) throw new Error('LIST_SIGNING_KEY must hold a PEM private key')
  const manifest = new Uint8Array(readFileSync(join(dir, 'manifest.json')))
  const sig = signManifest(manifest, pem)
  writeFileSync(join(dir, 'manifest.json.sig'), sig)
  console.log(`signed ${join(dir, 'manifest.json')} (${sig.length}-byte DER signature)`)
}

try {
  main()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
}
