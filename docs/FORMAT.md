# File formats

A release has these files:

| File | What it is |
|---|---|
| `hayaa-list-<serial>.bin.gz` | The list, binary format v2, gzip-compressed |
| `hayaa-list-<serial>.txt` | The same list as plain text, one entry per line |
| `starter.bin` | The starter list (exactly 50 hosts), binary format v2, not compressed, header serial 0 |
| `manifest.json` | Describes the list file: serial, sizes, hashes, probes |
| `manifest.json.sig` | Signature over `manifest.json` |
| `build-info.json` | Per-source line, host and skipped-line counts, the recent host counts, the entries held back for review, the gate overrides used and the SHA-256 of the release's `sources.lock.json`; read by the next build, never by the app |
| `build-info.json.sig` | Signature over `build-info.json` |
| `sources.lock.json` | The exact inputs the release was built from |
| `sources.lock.json.sig` | Signature over `sources.lock.json` |
| `LICENSE`, `CREDITS.md` | The licence of the list data (GPL-3.0-only) and its sources and attributions |

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

A host is any name that passes the structural check above: labels of 1 to
63 letters, digits or hyphens, not starting or ending with a hyphen. Some
listed hosts have hyphens in the third and fourth positions of a label
without being punycode (`69--gifs.tumblr.com`; 31 in the release of
2026-10-30). They are valid DNS names and stay in the list. IDNA's
"CheckHyphens" rule (ICU's HYPHEN_3_4 error) rejects them, so a reader or
normaliser must not apply that rule to list entries or to the hosts it looks
up, or those sites would never match.

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
    "size": 8892897,
    "sha256": "<64 lowercase hex>",
    "gzSize": 4948017,
    "gzSha256": "<64 lowercase hex>"
  },
  "hostCount": 1104537,
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
| `file.size` | uncompressed bytes, 32 bytes to 96 MiB |
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

`build-info.json.sig` and `sources.lock.json.sig` are made the same way over
those files. The app does not read them; the next monthly build does, and
refuses a previous release whose signatures do not verify.

The same key signs all three files, so each reader refuses the other two:
a manifest needs `"format": 2`, `build-info.json` its own
`buildInfoVersion` and the lock its own `lockVersion`, and
`build-info.json` and the lock are refused when they carry another file's
version field. `build-info.json` also names the SHA-256 of the
`sources.lock.json` attached to the same release; a lock that does not
match (one taken from another release) is refused.

## Compression

`hayaa-list-<serial>.bin.gz` is a single gzip member written by pako at
level 9 with a fixed header (no file name, modification time 0), so the same
list always compresses to the same bytes on any machine.

## starter.bin

The starter list uses the same v2 format as the full list, with header
serial **0**: it is never a release, so an app can never mistake it for a
monthly list (a real serial is always `YYYYMMDDNN`, far above 0). It holds
exactly 50 host entries (no page entries), every one also an entry of the
full list: the most visited sites of the full list by the Tranco ranking at
build time (registrable domains only), at most two per brand, skipping the
delivery and advertising domains and the general or mixed platforms in
`data/starter-exclude.txt` (they stay in the full list), plus the large
dedicated adult sites named in `data/starter-extra.txt`. A brand is the
name of the registrable domain without trailing digits or a hyphenated tail
(`xhamster2.com` and `xhamster.desi` are both `xhamster`), or the brand
`data/starter-brands.txt` gives a mirror whose name does not show it.

The app ships `starter.bin` inside the app, so a new one reaches users only
with an app update.

## build-info.json

UTF-8 JSON, two-space indentation and a final newline, signed like the
manifest. The next monthly build reads it from the latest release, after
checking its signature, to run its shrink and growth gates and to tell new
held-back entries from ones already waiting for review. `hostCountHistory`
holds the host counts of up to the last six releases, oldest first, this
one last; the slow-shrink gate compares with its largest value.
`gateOverrides` records whether the shrink or growth gates were skipped
(the workflow inputs `allow_shrink` and `allow_growth`), and
`sourcesLockSha256` the SHA-256 of the `sources.lock.json` the release was
built from.

```json
{
  "buildInfoVersion": 3,
  "serial": 2026110101,
  "hostCount": 1104537,
  "pathCount": 0,
  "hostCountHistory": [1104537],
  "sources": [
    { "id": "hagezi-nsfw", "commit": "<40 hex>", "sha256": "<64 hex>", "lines": 92336, "hosts": 92336, "skippedLines": 0 }
  ],
  "heldBack": { "topSites": [], "topSiteSubdomains": [] },
  "gateOverrides": { "allowShrink": false, "allowGrowth": false },
  "sourcesLockSha256": "<64 hex>"
}
```
