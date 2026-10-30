// Deterministic gzip. pako is a pure JavaScript port of zlib, so the same
// input gives the same compressed bytes on every machine and Node version
// (Node's own zlib can differ between builds and CPUs, and writes an
// OS-dependent header byte). The header carries no file name, no comment and
// a modification time of 0; the level is 9.

import { gzip } from 'pako'
import { gunzipSync } from 'node:zlib'

export const deterministicGzip = (data: Uint8Array): Uint8Array => {
  // With no header option, pako writes the fixed default header.
  const out = gzip(data, { level: 9 })
  // Header: 1f 8b 08 FLG MTIME(4) XFL OS. FLG must be 0 (no name, no comment,
  // no extra field), MTIME 0, XFL 2 (maximum compression), OS 3.
  if (out[0] !== 0x1f || out[1] !== 0x8b || out[2] !== 8 || out[3] !== 0) throw new Error('unexpected gzip header')
  if (out[4] !== 0 || out[5] !== 0 || out[6] !== 0 || out[7] !== 0) throw new Error('gzip mtime is not zero')
  if (out[8] !== 2 || out[9] !== 3) throw new Error('unexpected gzip header flags')
  return out
}

/** Inflate with Node's zlib: an independent implementation checks every gzip we write. */
export const gunzip = (data: Uint8Array): Uint8Array => new Uint8Array(gunzipSync(data))
