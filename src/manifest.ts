// The release manifest (manifest.json), the document the Hayaa app verifies
// before it downloads a list. validateManifest() applies the same rules as
// the app's parser (HayaaListManifest.kt): a manifest it refuses here would
// be refused on every phone, so the build never publishes one.
//
// Schema (format 2; unknown fields are ignored by the app):
//   {
//     "format": 2,
//     "serial": 2026110101,                  // YYYYMMDDNN, == the file header serial
//     "keyId": "k1",                         // which public key verifies manifest.json.sig
//     "file": {
//       "name": "hayaa-list-2026110101.bin.gz",
//       "size": 7864320,                     // uncompressed bytes
//       "sha256": "<64 lowercase hex>",      // of the uncompressed bytes
//       "gzSize": 3145728,                   // compressed bytes
//       "gzSha256": "<64 lowercase hex>"     // of the compressed bytes
//     },
//     "hostCount": 512345,                   // == the file header host count
//     "canaries":  [{ "host": "example.com", "path": "/x" }],  // 1..20, MUST match
//     "negatives": [{ "host": "wikipedia.org" }]              // optional, 0..20, must NOT match
//   }

export const MANIFEST_FORMAT = 2
export const MAX_MANIFEST_BYTES = 16 * 1024
export const MAX_SIG_BYTES = 512
export const MAX_GZ_BYTES = 40 * 1024 * 1024
export const MAX_RAW_BYTES = 96 * 1024 * 1024
export const MAX_PROBES = 20
const MIN_RAW_BYTES = 32
const MAX_HOST_CHARS = 253
const MAX_PATH_CHARS = 512
const U32_MAX = 0xffffffff
const FILE_NAME = /^hayaa-list-[0-9]{10}\.bin\.gz$/
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/
const HEX64 = /^[0-9a-f]{64}$/

export type Probe = { host: string; path?: string }

export type Manifest = {
  format: number
  serial: number
  keyId: string
  file: { name: string; size: number; sha256: string; gzSize: number; gzSha256: string }
  hostCount: number
  canaries: Probe[]
  negatives?: Probe[]
}

/** The release file name for a serial; the app requires exactly this. */
export const listFileName = (serial: number): string => `hayaa-list-${serial}.bin.gz`

/** Serialize with a fixed key order and layout, so the same build gives the same bytes. */
export const serializeManifest = (m: Manifest): Uint8Array => {
  const probe = (p: Probe): Probe => (p.path === undefined ? { host: p.host } : { host: p.host, path: p.path })
  const ordered = {
    format: m.format,
    serial: m.serial,
    keyId: m.keyId,
    file: { name: m.file.name, size: m.file.size, sha256: m.file.sha256, gzSize: m.file.gzSize, gzSha256: m.file.gzSha256 },
    hostCount: m.hostCount,
    canaries: m.canaries.map(probe),
    ...(m.negatives === undefined ? {} : { negatives: m.negatives.map(probe) }),
  }
  return new TextEncoder().encode(JSON.stringify(ordered, null, 2) + '\n')
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const inRange = (v: unknown, lo: number, hi: number): v is number => isInt(v) && v >= lo && v <= hi
const hex = (v: unknown): string | null => (typeof v === 'string' && HEX64.test(v.toLowerCase()) ? v.toLowerCase() : null)

const probes = (v: unknown): Probe[] | string => {
  if (!Array.isArray(v)) return 'probes must be an array'
  if (v.length > MAX_PROBES) return `more than ${MAX_PROBES} probes`
  const out: Probe[] = []
  for (const item of v) {
    if (!isObject(item)) return 'probe must be an object'
    const host = item.host
    if (typeof host !== 'string' || host.length === 0 || host.length > MAX_HOST_CHARS) return 'probe host out of range'
    if ('path' in item) {
      if (typeof item.path !== 'string') return 'probe path must be a string'
      if (item.path.length > MAX_PATH_CHARS) return 'probe path too long'
      out.push({ host, path: item.path })
    } else out.push({ host })
  }
  return out
}

/**
 * Null when the app would accept these exact bytes as a manifest, else the
 * reason. Beyond the field rules it requires strict UTF-8 and the canonical
 * layout serializeManifest() writes: re-serializing the parsed document must
 * give the same text, which rules out duplicate keys, non-integer numbers and
 * anything else the app's strict JSON reader could read differently.
 */
export const validateManifest = (bytes: Uint8Array): string | null => {
  if (bytes.length > MAX_MANIFEST_BYTES) return 'manifest larger than 16 KiB'
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 'manifest is not valid UTF-8'
  }
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return 'manifest is not JSON'
  }
  if (!isObject(o)) return 'manifest is not an object'
  if (JSON.stringify(o, null, 2) + '\n' !== text) return 'manifest is not in canonical form'
  if (o.format !== MANIFEST_FORMAT) return 'format must be 2'
  if (!inRange(o.serial, 1, U32_MAX)) return 'serial out of range'
  if (typeof o.keyId !== 'string' || !KEY_ID.test(o.keyId)) return 'keyId invalid'
  const file = o.file
  if (!isObject(file)) return 'file missing'
  if (typeof file.name !== 'string' || !FILE_NAME.test(file.name) || file.name !== listFileName(o.serial)) {
    return 'file.name must be hayaa-list-<serial>.bin.gz'
  }
  if (!inRange(file.size, MIN_RAW_BYTES, MAX_RAW_BYTES)) return 'file.size out of range'
  if (!inRange(file.gzSize, 1, MAX_GZ_BYTES)) return 'file.gzSize out of range'
  if (hex(file.sha256) === null) return 'file.sha256 invalid'
  if (hex(file.gzSha256) === null) return 'file.gzSha256 invalid'
  if (!inRange(o.hostCount, 0, U32_MAX)) return 'hostCount out of range'
  const canaries = probes(o.canaries)
  if (typeof canaries === 'string') return `canaries: ${canaries}`
  if (canaries.length === 0) return 'canaries: at least one is required'
  if ('negatives' in o) {
    const negatives = probes(o.negatives)
    if (typeof negatives === 'string') return `negatives: ${negatives}`
  }
  return null
}
