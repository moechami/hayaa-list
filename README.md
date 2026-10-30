# The Hayaa List

An open blocklist of adult websites. It is the list the Hayaa app's Blocker
uses on Android to block adult sites in the browser. Anyone may use it under
the GNU General Public License, version 3 or later.

The list holds about 615,000 hosts. A listed host also covers its
subdomains. The list can also hold page-level entries (an adult section of
an otherwise ordinary site); there are none yet.

## How it is built

`npm run build` does the following, with no manual step:

1. Fetch each source list at the exact commit pinned in `sources.lock.json`
   and check its SHA-256.
2. Parse the lines (hosts-file and plain-domain formats), normalize each
   host (lowercase, punycode, no `www.`), and merge all sources.
3. Add the reviewed entries in `data/additions.txt`.
4. Drop any entry that is a bare public suffix (`co.uk`, `blogspot.com`),
   using the pinned Public Suffix List.
5. Remove allowlisted hosts (`data/allowlist.txt`).
6. Drop hosts that a listed parent domain already covers.
7. Write the binary list, its gzip, a plain-text copy, the starter list and
   the manifest to `dist/`.

The build fails, and nothing is published, if any of these checks fails:

- the binary list does not pass full validation, or does not decode back to
  exactly the entries that went in;
- a canary (`data/canaries.txt`, well-known adult sites) does not match, or a
  negative (`data/negatives.txt`, popular ordinary sites) does;
- a site in the top 10,000 of the Tranco ranking would be blocked without
  being reviewed by hand (`data/reviewed-top-hits.txt`); the unreviewed ones
  are written to `dist/top-hits-candidates.txt`;
- a hand-kept entry is a public suffix, or is both added and allowlisted;
- the starter list is not a strict subset of the full list;
- the manifest breaks a rule the app enforces.

Building twice from the same `sources.lock.json` gives byte-identical files;
the monthly job checks this on every run.

```
npm ci
npm run build      # writes dist/
npm test
```

Node.js 22 or later. The build needs network access only to fetch the pinned
inputs, which it caches in `.cache/`.

## Sources and licences

The list combines ShadowWhisperer's Adult list, Sinfonietta's pornography
hosts, the MIT-licensed parts of StevenBlack's porn extensions, HaGeZi's
NSFW list and oisd's nsfw list. See [CREDITS.md](CREDITS.md) for each
source's licence, the evidence for it, the sources that were left out and
why, and the build-time references.

This repository, including the published lists, is licensed under the GNU
General Public License, version 3 or (at your option) any later version. See
[LICENSE](LICENSE).

## Reporting a site

Open a GitHub issue:

- **A site is blocked that should not be.** Give the address and what the
  site is. If the report is right, the site goes on the allowlist with a
  reason, and the fix ships in the next release.
- **An adult site is missing.** Give the address. Every report is checked by
  hand before it is added to `data/additions.txt`.

Nothing is added or removed automatically because of a report.

## Releases

A scheduled job builds a new release on the 1st of every month
(`.github/workflows/monthly.yml`): it re-pins every source to its latest
commit, builds, runs all checks and tests, signs the manifest and publishes
a GitHub release tagged `v<serial>`. If any step fails, nothing is published
and an issue is opened. If a source's licence file changes, the job stops
until a person has read the new licence.

Each release contains `hayaa-list-<serial>.bin.gz`, `hayaa-list-<serial>.txt`,
`starter.bin`, `manifest.json`, `manifest.json.sig` and the
`sources.lock.json` it was built from. The file formats, the matching rule
and the manifest are described in [docs/FORMAT.md](docs/FORMAT.md).

## Verifying a release

`manifest.json.sig` is an ECDSA P-256 signature over SHA-256 of the exact
bytes of `manifest.json`. The public keys are in `keys/`. With OpenSSL:

```
openssl dgst -sha256 -verify keys/k1.pub.pem -signature manifest.json.sig manifest.json
```

Then check that the SHA-256 of `hayaa-list-<serial>.bin.gz` equals
`file.gzSha256` in the manifest. To run every check the app runs (signature,
manifest rules, sizes and hashes, header, full validation, canaries and
negatives), put the release files in a folder and run:

```
npm run verify -- --dir <folder>
```

## Repository layout

| Path | Contents |
|---|---|
| `src/` | The build: formats, parsing, gates, manifest, signing |
| `scripts/` | `update-lock`, `sign`, `verify` |
| `data/` | Hand-kept files, each documented at its top |
| `keys/` | Public keys for release signatures |
| `test/` | Tests, including the shared format fixtures |
| `sources.lock.json` | Pinned inputs |
