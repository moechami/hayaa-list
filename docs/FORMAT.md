# File formats

A release has these files:

| File | What it is |
|---|---|
| `hayaa-list-<serial>.bin.gz` | The list, binary format v2, gzip-compressed |
| `hayaa-list-<serial>.txt` | The same list as plain text, one entry per line |
| `starter.bin` | The starter list (about 50 sites), binary format v2, not compressed |
| `manifest.json` | Describes the list file: serial, sizes, hashes, probes |
| `manifest.json.sig` | Signature over `manifest.json` |
| `sources.lock.json` | The exact inputs the release was built from |

The serial is `YYYYMMDDNN`: the UTC build date and a run number for that day
(`2026110101`). It only ever increases; the app refuses a release older than
the one it has.

`src/format.ts` is the reference implementation of everything below.

## Entries

- A **host entry** is a lowercase ASCII hostname (international names in
  punycode form), without a leading `www.`. It blocks that host and every
  subdomain of it: `example.com` blocks `example.com`, `www.example.com` and
  `a.b.example.com`, but never `notexample.com`.
- A **page entry** is a host, `/`, and one to three path segments
  (`example.com/gallery/adult`). It blocks that path and everything below it,
  on the host and its subdomains. Segments compare whole: `example.com/r/abc`
  does not match `/r/abcd`.

Entries are kept at the granularity the sources list them. A host already
covered by a listed parent is dropped as redundant.

## Matching rule

Given a host and an optional path:

1. Lowercase the host and strip one trailing `.`. Walk the host and each
   parent with at least two labels (`a.b.example.com`, `b.example.com`,
   `example.com`). If any is a host entry, it matches.
2. Only if the file has page entries and a path is given: lowercase the path,
   cut it at the first `?` or `#`, split on `/`, drop empty segments and keep
   the first three. For each host in the same walk and k = 1 to the number of
   segments, if `host/seg1/.../segk` is a page entry, it matches.
3. Otherwise it does not match. Malformed input never matches.

Lookups are exact: there is no probabilistic structure, so the list cannot
match a site that is not in it.

## Binary format v2

All integers are big-endian.

### Header (32 bytes)

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Magic `HYAB` |
| 4 | 1 | Version, `2` |
| 5 | 1 | Flags: bit 0 set when the file contains page entries; other bits 0 |
| 6 | 2 | Block-size target used when writing (informational) |
| 8 | 4 | Entry count (host and page entries) |
| 12 | 4 | Block count |
| 16 | 4 | Serial, `YYYYMMDDNN` |
| 20 | 4 | Host entry count |
| 24 | 8 | Reserved, zero |

### Keys

Every entry is stored as a key:

- host entry: the host with its labels reversed, `sub.example.com` becomes
  `com.example.sub`;
- page entry: the reversed host, `/`, then the segments,
  `example.com/gallery/adult` becomes `com.example/gallery/adult`.

Keys are 1 to 255 ASCII bytes. All keys are sorted bytewise into one
sequence and each appears once. Reversing the labels groups every host of a
domain together, which makes the front coding below effective.

### Block index

Right after the header: `blockCount` 32-bit absolute byte offsets, one per
block, strictly increasing. The first block starts right after the index.

### Blocks

Each block is a run of front-coded entries:

| Size | Field |
|---|---|
| 1 | Shared prefix length with the previous key in the block |
| 1 | Suffix length |
| n | Suffix bytes |

The first entry of a block always has a shared prefix length of 0 (a full
key), so a lookup can binary-search the blocks by their first key and then
scan one block. A writer closes a block once it reaches the block-size
target, so a block never spans more than the target plus one maximal entry
(257 bytes). Readers refuse a file with a wider block.

### Validation

A reader accepts a file only when the header and index are consistent with
the file size and, on full validation, every entry decodes inside its own
block, keys strictly increase across the whole file, the entry and host
counts equal the header's, and page keys appear only with the paths flag
set, each with 1 to 3 non-empty segments. A file that fails matches nothing.

Version 1 files (16-byte header without flags, serial or host count; host
entries only) are still read by the app for its older bundled list. This
repository writes version 2 only.

## Manifest

`manifest.json` is UTF-8 JSON, written with two-space indentation and a final
newline:

```json
{
  "format": 2,
  "serial": 2026110101,
  "keyId": "k1",
  "file": {
    "name": "hayaa-list-2026110101.bin.gz",
    "size": 4836631,
    "sha256": "<64 lowercase hex>",
    "gzSize": 2686335,
    "gzSha256": "<64 lowercase hex>"
  },
  "hostCount": 614939,
  "canaries": [{ "host": "pornhub.com" }, { "host": "pornhub.com", "path": "/view_video.php" }],
  "negatives": [{ "host": "wikipedia.org" }]
}
```

| Field | Rule |
|---|---|
| `format` | `2` |
| `serial` | 1 to 4294967295; equal to the list header's serial |
| `keyId` | 1 to 32 of `A-Z a-z 0-9 _ -`; names the key in `keys/` that signed it |
| `file.name` | exactly `hayaa-list-<serial>.bin.gz` |
| `file.size` | uncompressed bytes, 32 to 96 MiB |
| `file.sha256` | SHA-256 of the uncompressed bytes |
| `file.gzSize` | compressed bytes, 1 to 40 MiB |
| `file.gzSha256` | SHA-256 of the compressed bytes |
| `hostCount` | equal to the list header's host entry count |
| `canaries` | 1 to 20 probes that MUST match the list |
| `negatives` | optional, 0 to 20 probes that must NOT match |

A probe is `{ "host": "<1 to 253 chars>" }` with an optional
`"path": "<up to 512 chars>"`. Unknown fields are ignored by readers and are
still covered by the signature.

The app downloads `manifest.json` and `manifest.json.sig` from the latest
release, verifies the signature before reading any JSON, then downloads
`file.name` from the release tagged `v<serial>`, checks both sizes and
hashes while streaming, checks the header, validates every entry, and runs
every canary and negative. Anything less and it keeps the list it has.

## Signature

`manifest.json.sig` is an ECDSA signature on the NIST P-256 curve over the
SHA-256 of the exact bytes of `manifest.json`, DER-encoded (an ASN.1
SEQUENCE of two INTEGERs, at most 72 bytes). It is what

```
openssl dgst -sha256 -sign key.pem -out manifest.json.sig manifest.json
```

produces. The public keys are in `keys/` as PEM SubjectPublicKeyInfo.

## Compression

`hayaa-list-<serial>.bin.gz` is a single gzip member written by pako at
level 9 with a fixed header (no file name, modification time 0), so the same
list always compresses to the same bytes on any machine.

## starter.bin

The starter list uses the same v2 format and the same serial as the full
list. It holds the most visited sites of the full list (by the Tranco
ranking at build time, registrable domains only, skipping the delivery and
advertising domains in `data/starter-exclude.txt`) plus
`data/starter-extra.txt`. Every entry is also an entry of the full list.
