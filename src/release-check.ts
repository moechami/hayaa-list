// Checks a release folder the way the Hayaa app checks a download, in the
// same order: signature over the exact manifest bytes (before any JSON is
// read), the manifest's schema, the compressed and inflated sizes and
// hashes, the list header (version, serial, host count), a full validation of
// every entry, then every canary must match and no negative may.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hayaaListMatches, readHayaaListHeader, validateHayaaList } from './format'
import { gunzip } from './gzip'
import { validateManifest, type Manifest } from './manifest'
import { sha256Hex } from './pipeline'
import { verifyManifest } from './signing'

export type CheckResult = { ok: true; serial: number; keyId: string; checkedFile: boolean } | { ok: false; reason: string }

/**
 * `dir` holds manifest.json and manifest.json.sig, and optionally the
 * hayaa-list-<serial>.bin.gz it names (checked when present).
 */
export const checkRelease = (dir: string, publicKeyPem: string): CheckResult => {
  const manifest = new Uint8Array(readFileSync(join(dir, 'manifest.json')))
  const sig = new Uint8Array(readFileSync(join(dir, 'manifest.json.sig')))
  if (!verifyManifest(manifest, sig, publicKeyPem)) return { ok: false, reason: 'signature does not verify' }
  const problem = validateManifest(manifest)
  if (problem) return { ok: false, reason: `manifest refused (${problem})` }
  const m = JSON.parse(new TextDecoder().decode(manifest)) as Manifest

  const gzPath = join(dir, m.file.name)
  if (!existsSync(gzPath)) return { ok: true, serial: m.serial, keyId: m.keyId, checkedFile: false }
  const gz = new Uint8Array(readFileSync(gzPath))
  if (gz.length !== m.file.gzSize || sha256Hex(gz) !== m.file.gzSha256) return { ok: false, reason: 'compressed file does not match the manifest' }
  const raw = gunzip(gz)
  if (raw.length !== m.file.size || sha256Hex(raw) !== m.file.sha256) return { ok: false, reason: 'inflated file does not match the manifest' }
  const header = readHayaaListHeader(raw)
  if (!header || header.version !== 2 || header.serial !== m.serial || header.hostCount !== m.hostCount) {
    return { ok: false, reason: 'list header does not match the manifest' }
  }
  const invalid = validateHayaaList(raw)
  if (invalid) return { ok: false, reason: `list failed validation (${invalid})` }
  for (const c of m.canaries) if (!hayaaListMatches(raw, c.host, c.path ?? null)) return { ok: false, reason: `canary does not match: ${c.host}` }
  for (const n of m.negatives ?? []) if (hayaaListMatches(raw, n.host, n.path ?? null)) return { ok: false, reason: `negative matches: ${n.host}` }
  return { ok: true, serial: m.serial, keyId: m.keyId, checkedFile: true }
}
