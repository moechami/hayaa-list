// SPDX-License-Identifier: GPL-3.0-or-later
//
// Release signatures: ECDSA on P-256 over SHA-256, DER-encoded, computed over
// the exact bytes of a file. For manifest.json this is what the app verifies
// with Signature.getInstance("SHA256withECDSA"); build-info.json and
// sources.lock.json are signed the same way so the next build can trust
// them. It is what
//   openssl dgst -sha256 -sign key.pem -out manifest.json.sig manifest.json
// produces, so either tool can sign and either can verify.

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { MAX_SIG_BYTES } from './manifest'

const assertP256 = (key: KeyObject, what: string): void => {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error(`${what} must be an EC P-256 (prime256v1) key`)
  }
}

/** Sign `data` with a PEM private key. Throws on a key that is not P-256. */
export const signManifest = (data: Uint8Array, privateKeyPem: string): Uint8Array => {
  const key = createPrivateKey(privateKeyPem)
  assertP256(key, 'the signing key')
  const sig = new Uint8Array(sign('sha256', data, { key, dsaEncoding: 'der' }))
  // Check our own work before anything is written.
  if (!verify('sha256', data, { key: createPublicKey(key), dsaEncoding: 'der' }, sig)) {
    throw new Error('fresh signature does not verify')
  }
  return sig
}

/** True when `sig` is a valid DER signature over `data` by the PEM public key. Never throws. */
export const verifySignature = (data: Uint8Array, sig: Uint8Array, publicKeyPem: string): boolean => {
  try {
    if (sig.length === 0 || sig.length > MAX_SIG_BYTES) return false
    const key = createPublicKey(publicKeyPem)
    assertP256(key, 'the public key')
    return verify('sha256', data, { key, dsaEncoding: 'der' }, sig)
  } catch {
    return false
  }
}

/** The manifest's signature check (the same rule as any other signed file). */
export const verifyManifest = verifySignature

/** The public half of a PEM private key, as SubjectPublicKeyInfo PEM. */
export const publicKeyPemOf = (privateKeyPem: string): string =>
  createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString()

/** True when two PEM public keys are the same key (compared as DER, so formatting does not matter). */
export const samePublicKey = (aPem: string, bPem: string): boolean => {
  try {
    const der = (pem: string): Buffer => createPublicKey(pem).export({ type: 'spki', format: 'der' })
    return der(aPem).equals(der(bPem))
  } catch {
    return false
  }
}
