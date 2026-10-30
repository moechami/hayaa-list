// Hayaa List binary format (Blocker P6, architecture §8; v2 for the Hayaa
// List engine). Pure TypeScript — no Node APIs — so the same code is
// unit-tested under Jest and mirrored by HayaaListReader.kt on Android. The
// two MUST agree byte-for-byte: the Node side writes the file, the Kotlin side
// reads it in the accessibility service, and a divergence means a site
// silently never blocks.
//
// Two versions exist. The reader understands both and dispatches on byte 4;
// compileAdultList() still writes v1 (the bundled adult.bin and its fixture),
// compileHayaaList() writes v2. All integers are big-endian.
//
//   v1 header (16 bytes)
//     0..3   magic "HYAB"
//     4      version (1)
//     5      reserved (0)
//     6..7   u16 block-size target used at build time (informational)
//     8..11  u32 entry count
//     12..15 u32 block count
//
//   v2 header (32 bytes)
//     0..3   magic "HYAB"
//     4      version (2)
//     5      flags: bit 0 = the file contains path entries; other bits 0
//     6..7   u16 block-size target (informational)
//     8..11  u32 entry count (all keys, hosts and paths)
//     12..15 u32 block count
//     16..19 u32 serial: strictly increasing build number, YYYYMMDDNN
//            (2026110101); 0 for fixtures and unknown builds
//     20..23 u32 host entry count (keys without '/'), the "N sites" figure
//     24..31 reserved, zero
//
//   then, for both versions:
//   block index: blockCount × u32 absolute byte offset of each block
//   blocks: front-coded entries
//     entry = u8 sharedPrefixLen · u8 suffixLen · suffix bytes (ASCII)
//     the first entry of every block has sharedPrefixLen = 0 (a full key)
//
// Host keys are hosts with their labels REVERSED ("com.example.sub"),
// lowercase ASCII. Reversed order puts every host under the same TLD and
// registrable domain next to each other, which is what makes front coding cut
// the size by half; it also means a parent-domain walk is a handful of exact
// lookups. Path keys (v2) are a reversed host, "/", then 1 to 3 lowercase path
// segments ("com.reddit/r/nsfw"). Both kinds live in ONE sorted key space and
// are front-coded together; '.' (0x2E) sorts before '/' (0x2F), so a host's
// subdomains and its page entries sit side by side.
//
// Exact lookups only — there is no probabilistic structure anywhere, so the
// list cannot produce a false positive (founder rule, 2026-09-04: a wrong
// block during Timer Lock is unacceptable). A corrupt or unknown-version file
// matches nothing: enforcement fails OPEN, never closed.
//
// Bounded work per lookup (audit B1). The writer closes a block once it
// reaches the header's block-size target, so no block it writes spans more
// than blockSize + one maximal entry (2 + 255 bytes). Readers refuse at open
// time any file with a block wider than that (plus BLOCK_SPAN_SLACK, never
// above MAX_BLOCK_SPAN), and also stop a single block scan after
// maxScanSteps() entries. Without the cap one index entry could cover the
// whole file and turn every lookup on the accessibility service's main thread
// into a scan of millions of entries (an ANR).
//
// Full validation (audit B3). The open-time check covers the header and the
// index only. validateHayaaList() decodes every entry once and checks what
// lookups silently rely on: keys strictly increasing across the file, entries
// inside their block, counts equal to the header's. The build runs it before
// writing; the phone runs HayaaListReader.validate() on a download before it
// is installed and on the bundled asset before it is adopted.
//
// Known gap for P3 (audit B4, not handled here): path matching does no
// percent-decoding, no "." / ".." segment resolution and no backslash
// handling, and lowercasing paths can over-match on sites whose paths are
// case-sensitive. Callers must pass hosts through DomainMatcher.normalize
// (IDN to punycode, port, userinfo, leading www) before the reader.

export const ADULT_LIST_MAGIC = 'HYAB'
export const ADULT_LIST_VERSION = 1
export const HAYAA_LIST_VERSION = 2
/** v2 flags bit 0: the file holds page (path) entries as well as hosts. */
export const HAYAA_LIST_FLAG_PATHS = 0x01
/** Page entries go at most this deep ("r/nsfw/top"); deeper URLs match a prefix. */
export const MAX_PATH_SEGMENTS = 3
export const DEFAULT_BLOCK_SIZE = 4096
const HEADER_BYTES = 16
const HEADER_BYTES_V2 = 32
const MAX_KEY_LENGTH = 255
const U32_MAX = 0xffffffff
/** One entry at its largest: two length bytes and a 255-byte suffix. */
const MAX_ENTRY_BYTES = 2 + MAX_KEY_LENGTH
/** Room above the writer's exact bound, so a future rounding change in the writer cannot brick shipped readers. */
const BLOCK_SPAN_SLACK = 64
/** No block may span more than this, whatever the header claims (u16 block-size field + one entry). */
export const MAX_BLOCK_SPAN = 0xffff + MAX_ENTRY_BYTES
/** Every valid entry is at least 3 bytes: a non-empty key, so a non-empty suffix (keys strictly increase). */
const MIN_ENTRY_BYTES = 3

/** Widest block a reader accepts for a file whose header says `blockSize`. */
export const maxBlockSpan = (blockSize: number): number =>
  Math.min(blockSize + MAX_ENTRY_BYTES + BLOCK_SPAN_SLACK, MAX_BLOCK_SPAN)

/** Most entries one block scan may step through; more means the block is corrupt. */
export const maxScanSteps = (blockSize: number): number => Math.floor(maxBlockSpan(blockSize) / MIN_ENTRY_BYTES) + 1

/** "sub.example.com" → "com.example.sub". Applied to keys and to lookups. */
export const reverseLabels = (host: string): string => host.split('.').reverse().join('.')

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 0x7f) throw new Error('adult list keys must be ASCII (punycode for IDNs)')
    out[i] = c
  }
  return out
}

const bytewiseLess = (a: string, b: string): boolean => {
  // JS string comparison is by UTF-16 code unit, which equals bytewise
  // order for ASCII — the invariant ascii() enforces above.
  return a < b
}

/**
 * Front-code sorted, validated keys into the block area. Shared by both
 * writers so v1 output stays byte-identical to what it always was.
 */
const encodeBlocks = (keys: readonly string[], blockSize: number): { chunks: Uint8Array[]; blockStarts: number[]; written: number } => {
  const chunks: Uint8Array[] = []
  const blockStarts: number[] = []
  let written = 0
  let blockBytes = 0
  let prev = ''
  for (const key of keys) {
    let shared = 0
    if (blockBytes === 0) {
      blockStarts.push(written)
    } else {
      while (shared < prev.length && shared < key.length && shared < 255 && prev[shared] === key[shared]) shared++
    }
    const suffix = ascii(key.slice(shared))
    const entry = new Uint8Array(2 + suffix.length)
    entry[0] = shared
    entry[1] = suffix.length
    entry.set(suffix, 2)
    chunks.push(entry)
    written += entry.length
    blockBytes += entry.length
    if (blockBytes >= blockSize) blockBytes = 0
    prev = key
  }
  return { chunks, blockStarts, written }
}

/** Lay out header + index + blocks; the caller fills its version's header fields. */
const assemble = (
  headerBytes: number,
  encoded: { chunks: Uint8Array[]; blockStarts: number[]; written: number },
  writeHeader: (view: DataView, out: Uint8Array) => void,
): Uint8Array => {
  const { chunks, blockStarts, written } = encoded
  const base = headerBytes + 4 * blockStarts.length
  const out = new Uint8Array(base + written)
  const view = new DataView(out.buffer)
  out.set(ascii(ADULT_LIST_MAGIC), 0)
  writeHeader(view, out)
  view.setUint32(12, blockStarts.length)
  blockStarts.forEach((start, i) => view.setUint32(headerBytes + 4 * i, base + start))
  let cursor = base
  for (const c of chunks) {
    out.set(c, cursor)
    cursor += c.length
  }
  return out
}

/**
 * Compile normalized hosts into a v1 binary (the bundled adult.bin format).
 * Input order does not matter; duplicates are removed. Throws on non-ASCII or
 * on a key longer than 255 bytes (a hostname is at most 253).
 */
export const compileAdultList = (
  hosts: readonly string[],
  blockSize: number = DEFAULT_BLOCK_SIZE,
): Uint8Array => {
  const keys = Array.from(new Set(hosts.map(reverseLabels))).sort()
  for (const k of keys) {
    if (k.length === 0 || k.length > MAX_KEY_LENGTH) throw new Error('adult list key length out of range')
  }
  return assemble(HEADER_BYTES, encodeBlocks(keys, blockSize), (view, out) => {
    out[4] = ADULT_LIST_VERSION
    out[5] = 0
    view.setUint16(6, blockSize)
    view.setUint32(8, keys.length)
  })
}

/** Build-time counts reported by compileHayaaList (no names, counts only). */
export type HayaaListStats = {
  hosts: number
  paths: number
  /** Page entries dropped because their host, or a parent of it, is a listed host. */
  pathsCoveredByHost: number
  /** Page entries dropped because a shorter listed page entry already covers them. */
  pathsCoveredByPath: number
}

export type HayaaListInput = {
  /** Plain hosts ("sub.example.com"), not reversed. */
  hosts: readonly string[]
  /** Page entries as "host/seg1[/seg2[/seg3]]", host not reversed. */
  paths?: readonly string[]
  /** Strictly increasing build number (YYYYMMDDNN); 0 for fixtures. */
  serial: number
  blockSize?: number
}

/** Every parent of `host` with at least two labels, the host itself first. */
const hostWalk = (host: string): string[] => {
  const labels = host.split('.')
  const out: string[] = []
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'))
  return out
}

const checkKeyChars = (s: string, what: string): void => {
  ascii(s) // throws on non-ASCII
  if (s.includes('?') || s.includes('#')) throw new Error(`${what} must not contain '?' or '#'`)
}

/**
 * Compile hosts and page entries into a v2 binary. Hosts and paths are
 * lowercased; duplicates are removed. A page entry that a listed host (or a
 * listed parent of its host) already blocks is dropped as redundant, as is
 * one a shorter listed page entry already covers, because the runtime walk
 * would block it anyway. Throws on non-ASCII, '?' or '#', a key outside
 * 1..255 bytes, a host containing '/', or a page entry without 1..3 non-empty
 * segments — a bad source line must fail the build, never ship silently.
 */
export const compileHayaaList = (input: HayaaListInput): { bytes: Uint8Array; stats: HayaaListStats } => {
  const blockSize = input.blockSize ?? DEFAULT_BLOCK_SIZE
  if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > 0xffff) throw new Error('block size out of range')
  if (!Number.isInteger(input.serial) || input.serial < 0 || input.serial > U32_MAX) throw new Error('serial out of range')

  const hosts = new Set<string>()
  for (const raw of input.hosts) {
    const h = raw.toLowerCase()
    checkKeyChars(h, 'host')
    if (h.includes('/')) throw new Error('host entries must not contain "/"')
    if (h.length === 0 || h.length > MAX_KEY_LENGTH) throw new Error('adult list key length out of range')
    hosts.add(h)
  }

  // Parse page entries into (host, segments); dedupe on the normalized form.
  const parsed = new Map<string, { host: string; segs: string[] }>()
  for (const raw of input.paths ?? []) {
    const p = raw.toLowerCase()
    checkKeyChars(p, 'page entry')
    const slash = p.indexOf('/')
    if (slash <= 0) throw new Error('page entry needs a host and a path')
    const host = p.slice(0, slash)
    const segs = p.slice(slash + 1).split('/')
    if (segs.length < 1 || segs.length > MAX_PATH_SEGMENTS || segs.some((s) => s.length === 0)) {
      throw new Error(`page entry needs 1..${MAX_PATH_SEGMENTS} non-empty segments`)
    }
    if (host.split('.').length < 2) throw new Error('page entry host needs at least two labels')
    const key = `${reverseLabels(host)}/${segs.join('/')}`
    if (key.length > MAX_KEY_LENGTH) throw new Error('adult list key length out of range')
    parsed.set(key, { host, segs })
  }

  let pathsCoveredByHost = 0
  let pathsCoveredByPath = 0
  const pathKeys: string[] = []
  for (const [key, { host, segs }] of parsed) {
    const walk = hostWalk(host)
    if (walk.some((h) => hosts.has(h))) {
      pathsCoveredByHost++
      continue
    }
    // Covered by a shorter page entry under the same host or a parent host.
    const covered = walk.some((h) => {
      for (let k = 1; k <= segs.length; k++) {
        const candidate = `${reverseLabels(h)}/${segs.slice(0, k).join('/')}`
        if (candidate !== key && parsed.has(candidate)) return true
      }
      return false
    })
    if (covered) {
      pathsCoveredByPath++
      continue
    }
    pathKeys.push(key)
  }

  const hostKeys = [...hosts].map(reverseLabels)
  const keys = [...hostKeys, ...pathKeys].sort()
  const bytes = assemble(HEADER_BYTES_V2, encodeBlocks(keys, blockSize), (view, out) => {
    out[4] = HAYAA_LIST_VERSION
    out[5] = pathKeys.length > 0 ? HAYAA_LIST_FLAG_PATHS : 0
    view.setUint16(6, blockSize)
    view.setUint32(8, keys.length)
    view.setUint32(16, input.serial)
    view.setUint32(20, hostKeys.length)
    // 24..31 stay zero (reserved).
  })
  return { bytes, stats: { hosts: hostKeys.length, paths: pathKeys.length, pathsCoveredByHost, pathsCoveredByPath } }
}

/** Everything the header says, for either version. */
export type HayaaListHeader = {
  version: number
  flags: number
  blockSize: number
  entryCount: number
  blockCount: number
  /** 0 for v1 files, fixtures and unknown builds. */
  serial: number
  /** Keys without '/'. Equals entryCount for v1. */
  hostCount: number
  hasPaths: boolean
  headerBytes: number
}

/**
 * Parsed and sanity-checked header, or null when the bytes are not a list we
 * understand. Mirrors HayaaListReader.of(): the counts must fit the file,
 * every block offset must point inside it, strictly increasing, and no block
 * may span more than maxBlockSpan(blockSize) bytes, so the lookup code can
 * trust them and its work per lookup is bounded. Unknown flag bits and
 * reserved bytes are ignored.
 */
export const readHayaaListHeader = (data: Uint8Array): HayaaListHeader | null => {
  if (data.length < HEADER_BYTES) return null
  for (let i = 0; i < 4; i++) if (data[i] !== ADULT_LIST_MAGIC.charCodeAt(i)) return null
  const version = data[4]
  const headerBytes = version === ADULT_LIST_VERSION ? HEADER_BYTES : version === HAYAA_LIST_VERSION ? HEADER_BYTES_V2 : -1
  if (headerBytes < 0 || data.length < headerBytes) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flags = version === HAYAA_LIST_VERSION ? data[5] : 0
  const entryCount = view.getUint32(8)
  const blockCount = view.getUint32(12)
  const serial = version === HAYAA_LIST_VERSION ? view.getUint32(16) : 0
  const hostCount = version === HAYAA_LIST_VERSION ? view.getUint32(20) : entryCount
  const hasPaths = (flags & HAYAA_LIST_FLAG_PATHS) !== 0

  const base = headerBytes + 4 * blockCount
  if (base > data.length) return null
  if (entryCount * 2 > data.length - base) return null // every entry is at least 2 bytes
  if (blockCount > entryCount || (entryCount > 0 && blockCount === 0)) return null
  if (hostCount > entryCount || (!hasPaths && hostCount !== entryCount)) return null
  const blockSize = view.getUint16(6)
  const maxSpan = maxBlockSpan(blockSize)
  let last = -1
  for (let b = 0; b < blockCount; b++) {
    const off = view.getUint32(headerBytes + 4 * b)
    if (off < base || off >= data.length || off <= last) return null
    if (last >= 0 && off - last > maxSpan) return null // the previous block is too wide
    last = off
  }
  if (last >= 0 && data.length - last > maxSpan) return null // so is the last one
  return { version, flags, blockSize, entryCount, blockCount, serial, hostCount, hasPaths, headerBytes }
}

/** v1-era projection of the header, kept for existing callers. Reads v1 and v2. */
export const readAdultListHeader = (
  data: Uint8Array,
): { entryCount: number; blockCount: number; blockSize: number } | null => {
  const h = readHayaaListHeader(data)
  return h ? { blockSize: h.blockSize, entryCount: h.entryCount, blockCount: h.blockCount } : null
}

/** One front-coded entry, or null when it runs past the file or is inconsistent. */
const decodeAt = (data: Uint8Array, offset: number, prev: string): { key: string; next: number } | null => {
  if (offset + 2 > data.length) return null
  const shared = data[offset]
  const len = data[offset + 1]
  if (shared > prev.length || offset + 2 + len > data.length) return null
  let key = prev.slice(0, shared)
  for (let i = 0; i < len; i++) key += String.fromCharCode(data[offset + 2 + i])
  return { key, next: offset + 2 + len }
}

/** Exact lookup with a pre-read header. Corrupt entries end the search with false. */
const containsWith = (data: Uint8Array, header: HayaaListHeader, reversedKey: string): boolean => {
  if (header.blockCount === 0 || reversedKey.length === 0 || reversedKey.length > MAX_KEY_LENGTH) return false
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const blockOffset = (i: number): number => view.getUint32(header.headerBytes + 4 * i)

  // Binary search for the last block whose first key <= target.
  let lo = 0
  let hi = header.blockCount - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    // prev = '' makes decodeAt refuse a block whose first entry claims a
    // shared prefix, so `first` is always a full key.
    const first = decodeAt(data, blockOffset(mid), '')
    if (!first) return false
    if (bytewiseLess(reversedKey, first.key)) hi = mid - 1
    else {
      found = mid
      lo = mid + 1
    }
  }
  if (found === -1) return false

  // Linear scan inside that block; keys are sorted so stop once past target.
  // The step cap is a second line behind the open-time span check: a valid
  // block never reaches it, so hitting it means corruption, which misses.
  const end = found + 1 < header.blockCount ? blockOffset(found + 1) : data.length
  const stepCap = maxScanSteps(header.blockSize)
  let steps = 0
  let offset = blockOffset(found)
  let prev = ''
  while (offset < end) {
    if (++steps > stepCap) return false
    const entry = decodeAt(data, offset, prev)
    if (!entry) return false
    const { key, next } = entry
    if (key === reversedKey) return true
    if (bytewiseLess(reversedKey, key)) return false
    prev = key
    offset = next
  }
  return false
}

/** Exact lookup of one REVERSED key (host or path). Mirrors HayaaListReader.contains(). */
export const hayaaListContains = (data: Uint8Array, reversedKey: string): boolean => {
  try {
    const header = readHayaaListHeader(data)
    return header ? containsWith(data, header, reversedKey) : false
  } catch {
    return false
  }
}

/** v1-era name for hayaaListContains, kept for existing callers. */
export const adultListContains = hayaaListContains

/**
 * Lowercase, drop the query and fragment, split on '/', drop empty segments,
 * keep the first three. "/R/NSFW/?x=1#top" → ["r", "nsfw"].
 */
export const normalizePathSegments = (path: string): string[] => {
  let p = path.toLowerCase()
  const q = p.search(/[?#]/)
  if (q >= 0) p = p.slice(0, q)
  return p.split('/').filter((s) => s.length > 0).slice(0, MAX_PATH_SEGMENTS)
}

/**
 * The matching rule, identical to HayaaListReader.matches():
 *   1. the host (lowercased, one trailing '.' stripped) or any parent of at
 *      least two labels is a listed host → match. "notexample.com" never
 *      matches "example.com" because the walk moves by whole labels;
 *   2. only when the file has page entries and a path is given: for each host
 *      in the same walk and k = 1..min(3, segments), reversedHost + "/" + the
 *      first k segments is listed → match. Segments compare whole, so
 *      "/r/nsfwfoo" never matches "r/nsfw";
 *   3. otherwise no match. Never throws; malformed input is no match.
 */
export const hayaaListMatches = (data: Uint8Array, host: string, path?: string | null): boolean => {
  try {
    const header = readHayaaListHeader(data)
    if (!header) return false
    let h = host.toLowerCase()
    if (h.endsWith('.')) h = h.slice(0, -1)
    const walk = hostWalk(h).map(reverseLabels)
    for (const rev of walk) if (containsWith(data, header, rev)) return true
    if (!header.hasPaths || path == null) return false
    const segs = normalizePathSegments(path)
    for (const rev of walk) {
      for (let k = 1; k <= segs.length; k++) {
        if (containsWith(data, header, `${rev}/${segs.slice(0, k).join('/')}`)) return true
      }
    }
    return false
  } catch {
    return false
  }
}

/** Host-only matching, the v1-era API. Reads v1 and v2 files. */
export const adultListMatches = (data: Uint8Array, host: string): boolean => hayaaListMatches(data, host)

/**
 * Decode every key into plain hosts and "host/seg/seg" page entries
 * (build-time stats and tests only — never at runtime). Throws on a file the
 * reader would refuse, so a build cannot write one.
 */
export const decodeHayaaList = (data: Uint8Array): { hosts: string[]; paths: string[] } => {
  const header = readHayaaListHeader(data)
  if (!header) throw new Error('not an adult list')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const hosts: string[] = []
  const paths: string[] = []
  for (let b = 0; b < header.blockCount; b++) {
    let offset = view.getUint32(header.headerBytes + 4 * b)
    const end = b + 1 < header.blockCount ? view.getUint32(header.headerBytes + 4 * (b + 1)) : data.length
    let prev = ''
    while (offset < end) {
      const entry = decodeAt(data, offset, prev)
      if (!entry) throw new Error('corrupt entry')
      const slash = entry.key.indexOf('/')
      if (slash < 0) hosts.push(reverseLabels(entry.key))
      else paths.push(`${reverseLabels(entry.key.slice(0, slash))}${entry.key.slice(slash)}`)
      prev = entry.key
      offset = entry.next
    }
  }
  return { hosts, paths }
}

const SLASH = 0x2f

/** Problem with the page key key[0, len) whose first '/' is at `slash`, or null. */
const pathKeyProblem = (key: Uint8Array, slash: number, len: number): string | null => {
  if (slash === 0) return 'page entry without a host'
  let segments = 0
  let segLen = 0
  for (let i = slash + 1; i < len; i++) {
    if (key[i] === SLASH) {
      if (segLen === 0) return 'empty page segment'
      segments++
      segLen = 0
    } else segLen++
  }
  if (segLen === 0) return 'empty page segment'
  if (++segments > MAX_PATH_SEGMENTS) return `page entry deeper than ${MAX_PATH_SEGMENTS} segments`
  return null
}

/**
 * Full linear validation: decodes every entry once and returns null when the
 * file is sound, else a short reason (never key content). Mirrors
 * HayaaListReader.validate(); the two must accept and refuse the same files.
 * Beyond the open-time header and index check it requires: the first block
 * right after the index; every entry inside its own block; a block's first
 * entry a full key; a shared prefix no longer than the previous key; keys of
 * 1..255 ASCII bytes, strictly increasing bytewise across the WHOLE file
 * (lookups binary-search on that order, so an unsorted file misses sites
 * without any error); entryCount and hostCount equal to what is there; page
 * keys only when the paths flag is set, each a host plus 1..3 non-empty
 * segments. Linear in the file size; the build calls it before writing.
 */
export const validateHayaaList = (data: Uint8Array): string | null => {
  const header = readHayaaListHeader(data)
  if (!header) return 'header or block index refused'
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const base = header.headerBytes + 4 * header.blockCount
  if (header.blockCount === 0) return data.length === base ? null : 'bytes after the block index'
  if (view.getUint32(header.headerBytes) !== base) return 'gap before the first block'

  // The previous key, kept across blocks so order is checked file-wide.
  const key = new Uint8Array(MAX_KEY_LENGTH)
  let keyLen = 0
  let entries = 0
  let hosts = 0
  for (let b = 0; b < header.blockCount; b++) {
    let off = view.getUint32(header.headerBytes + 4 * b)
    const end = b + 1 < header.blockCount ? view.getUint32(header.headerBytes + 4 * (b + 1)) : data.length
    let first = true
    while (off < end) {
      if (off + 2 > end) return 'entry crosses its block end'
      const shared = data[off]
      const suffixLen = data[off + 1]
      if (off + 2 + suffixLen > end) return 'entry crosses its block end'
      if (first && shared !== 0) return 'block starts with a shared prefix'
      if (shared > keyLen) return 'shared prefix longer than the previous key'
      const len = shared + suffixLen
      if (len === 0 || len > MAX_KEY_LENGTH) return 'key length out of range'
      // [0, shared) is copied from the previous key, so compare from `shared` on.
      let cmp = 0
      for (let i = shared; cmp === 0 && i < len && i < keyLen; i++) cmp = data[off + 2 + i - shared] - key[i]
      if (cmp === 0) cmp = len - keyLen
      if (entries > 0 && cmp <= 0) return 'keys not strictly increasing'
      for (let j = 0; j < suffixLen; j++) {
        const c = data[off + 2 + j]
        if (c > 0x7f) return 'non-ASCII key'
        key[shared + j] = c
      }
      keyLen = len
      const slash = key.subarray(0, keyLen).indexOf(SLASH)
      if (slash < 0) hosts++
      else {
        if (!header.hasPaths) return 'page entry without the paths flag'
        const problem = pathKeyProblem(key, slash, keyLen)
        if (problem) return problem
      }
      entries++
      off += 2 + suffixLen
      first = false
    }
  }
  if (entries !== header.entryCount) return 'entry count differs from the header'
  if (hosts !== header.hostCount) return 'host count differs from the header'
  return null
}

/** Hosts only, the v1-era API (build-time stats and tests only). */
export const decodeAdultList = (data: Uint8Array): string[] => decodeHayaaList(data).hosts
