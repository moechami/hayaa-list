// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
/* Sign a built release folder, for a LOCAL TRIAL with a throwaway key.
 *
 *   LIST_SIGNING_KEY="$(cat throwaway.pem)" npm run sign [-- --dir dist] [--force]
 *
 * Reads an EC P-256 private key (PEM) from the LIST_SIGNING_KEY environment
 * variable, never from a file in the repository, and writes a DER ECDSA
 * signature over SHA-256 of the exact bytes of each signed file in <dir>:
 * manifest.json.sig, build-info.json.sig and, when the folder has one,
 * sources.lock.json.sig. The same result as
 *   openssl dgst -sha256 -sign key.pem -out manifest.json.sig manifest.json
 *
 * It refuses a key whose public half is one of the release keys in keys/
 * (the production key belongs to the release workflow only), unless
 * --force is given. Releases are signed by the workflow's sign job with
 * OpenSSL; see keys/README.md.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readPublicKeys } from '../src/previous'
import { publicKeyPemOf, samePublicKey, signManifest } from '../src/signing'

/** The files a release signs, in order; the last one is optional. */
export const SIGNED_FILES = ['manifest.json', 'build-info.json', 'sources.lock.json'] as const

/** Null when `privatePem` may sign locally, else why not. */
export const productionKeyProblem = (privatePem: string, releaseKeys: ReadonlyMap<string, string>, force: boolean): string | null => {
  if (force) return null
  const pub = publicKeyPemOf(privatePem)
  for (const [keyId, pem] of releaseKeys) {
    if (samePublicKey(pub, pem)) {
      return `this is the release key "${keyId}" (keys/${keyId}.pub.pem); releases are signed by the workflow only. Use a throwaway key, or --force if you really mean it`
    }
  }
  return null
}

const main = (): void => {
  console.warn('warning: local signing only; releases are signed by the workflow with OpenSSL (see keys/README.md)')
  const i = process.argv.indexOf('--dir')
  const dir = resolve(i >= 0 ? (process.argv[i + 1] ?? '') : join(__dirname, '..', 'dist'))
  const pem = process.env.LIST_SIGNING_KEY
  if (!pem || !pem.includes('PRIVATE KEY')) throw new Error('LIST_SIGNING_KEY must hold a PEM private key')
  const problem = productionKeyProblem(pem, readPublicKeys(join(__dirname, '..', 'keys')), process.argv.includes('--force'))
  if (problem) throw new Error(`refused: ${problem}`)
  for (const name of SIGNED_FILES) {
    const path = join(dir, name)
    if (!existsSync(path)) {
      if (name === 'sources.lock.json') continue
      throw new Error(`${path} is missing`)
    }
    const sig = signManifest(new Uint8Array(readFileSync(path)), pem)
    writeFileSync(`${path}.sig`, sig)
    console.log(`signed ${path} (${sig.length}-byte DER signature)`)
  }
}

if (require.main === module) {
  try {
    main()
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  }
}
