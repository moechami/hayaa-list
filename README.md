# The Hayaa List

An open blocklist of adult websites. It is the list the Hayaa app's Blocker
uses on Android to block adult sites in the browser.

The full list holds about 1.1 million hosts. A listed host also covers its
subdomains. The list can also hold page-level entries (an adult section of
an otherwise ordinary site); there are none yet.

Two lists are published:

- **The full list** (`hayaa-list-<serial>.bin.gz`): every entry, including
  the mirror and proxy (bypass) domains its sources list and any page-level
  entries, updated by a monthly release. The app downloads it over the air.
- **The starter list** (`starter.bin`): exactly 50 hosts, the most visited
  adult sites with at most two domains per brand, host entries only. It is
  deliberately small. The app ships it inside the app itself, so it changes
  only when the app is updated, never over the air.

## Licences

- **The list data** (every file attached to a release: the binary and text
  lists, `starter.bin`, the manifest and its metadata) is licensed under the
  GNU General Public License, **version 3 only** (`GPL-3.0-only`). Two of its
  sources, HaGeZi and oisd, publish the version 3 text without an "or later"
  grant, so the combined list cannot offer later versions.
- **The code in this repository** (`src/`, `scripts/`, `test/`, the
  workflows) is licensed under the GNU General Public License, version 3 or
  (at your option) any later version (`GPL-3.0-or-later`), as `package.json`
  states.

The licence text is in [LICENSE](LICENSE), and every release carries
`LICENSE` and `CREDITS.md`. [CREDITS.md](CREDITS.md) gives each source's
licence, the evidence for it, the sources that were left out and why, and
the build-time references.

## Sources

ShadowWhisperer's Adult list, Sinfonietta's pornography hosts, the
MIT-licensed parts of StevenBlack's porn extensions, HaGeZi's NSFW list,
oisd's nsfw list, and The Block List Project's porn list. The Block List
Project's repository is archived, so its list is **frozen**: pinned to its
final version and never re-pinned. It is the list the app's earlier bundled
blocklist was built from, so the full list covers everything that one did,
apart from reviewed mistakes.

## How it is built

`npm run build` does the following, with no manual step:

1. Fetch each input at the exact commit (or list ID) pinned in
   `sources.lock.json` and check its SHA-256.
2. Parse the lines (hosts-file and plain-domain formats), normalize each
   host (lowercase, punycode, no `www.`, at most 253 characters) and merge
   all sources.
3. Add the reviewed entries in `data/additions.txt`.
4. Drop any entry that is a bare public suffix (`co.uk`, `blogspot.com`),
   using the pinned Public Suffix List.
5. Remove allowlisted hosts (`data/allowlist.txt`).
6. Apply the review gates (below), holding back new unreviewed popular
   entries.
7. Drop hosts that a listed parent domain already covers.
8. Write the binary list, its gzip, a plain-text copy, the starter list,
   the manifest and `build-info.json` to `dist/`.

### Review gates

Popular sites need a person's review before the list blocks them:

- **Top sites.** A site in the top 10,000 of the pinned Tranco ranking
  must be named in `data/reviewed-top-hits.txt` (genuinely adult) or in
  `data/allowlist.txt` (a mistake, with a reason).
- **Subdomains of the top 1,000 sites.** A listed host such as `m.vk.com`
  leaves `vk.com` itself reachable but would still break it for most people,
  so every listed subdomain of a top-1,000 site must be covered by
  `data/reviewed-top-site-subdomains.txt` (a host, or a `*.` rule for
  platforms where each subdomain is a separate person's site, such as
  `*.tumblr.com`) or allowlisted.

An unreviewed entry that the previous release already listed stays listed.
A new one is **held back**: it is left out of this release, recorded in
`build-info.json` and listed in an issue, and it waits there, month after
month, until someone reviews it. The release still ships. Only a burst of
more than 25 new entries at once, which suggests a broken or poisoned
upstream list, stops the release.

### Other gates

The build fails, and nothing is published, if any of these fails:

- the binary list does not pass full validation, or does not decode back to
  exactly the entries that went in;
- a canary (`data/canaries.txt`, well-known adult sites) does not match, or a
  negative (`data/negatives.txt`, popular ordinary sites) does, or a
  negative is not on the allowlist;
- compared with the previous release, the list lost more than 10% of its
  hosts or one source lost more than 30% of its own (a truncated or changed
  upstream);
- more than 1% of a source's lines (and at least 100) cannot be read, which
  means its format changed;
- a hand-kept entry is a public suffix, or is both added and allowlisted;
- the starter list does not have exactly 50 entries, takes more than two
  from one brand, includes a proxy or bypass site, or is not a strict subset
  of the full list;
- the manifest breaks a rule the app enforces.

Building twice from the same inputs gives byte-identical files; the monthly
job checks this on every run.

```
npm ci
npm run build                       # writes dist/, compares with the build already in dist/
npm run build -- --previous none    # compares with nothing
npm test
```

Node.js 22 or later. The build needs network access only to fetch the pinned
inputs, which it caches in `.cache/`. `dist/review-top-site-subdomains.txt`
lists every listed subdomain of the top 10,000 sites as a review aid; it is
never published.

## Releases

A scheduled job attempts a release on the 1st of every month
(`.github/workflows/monthly.yml`):

1. It downloads the previous release (its plain-text list, `build-info.json`
   and `sources.lock.json`) to compare against. With no release yet it
   compares against nothing; any other GitHub API error stops the job.
2. It re-pins every source that is not frozen to its latest commit. A
   source whose repository or file has disappeared, or whose licence file
   changed, keeps the pin it had in the previous release; an issue says so
   and the release still ships. A changed licence is accepted only after a
   person has read it (`npm run update-lock -- --accept-license-change`).
3. It runs the type check and every test, builds, builds again to check the
   bytes are identical, and runs every gate.
4. From `main` only, in the protected `release` environment (a person
   approves it), it signs the manifest with OpenSSL, verifies the signature
   with OpenSSL and with every check the app runs, and publishes a GitHub
   release tagged `v<serial>`.
5. It commits the `sources.lock.json` the release was built from to `main`,
   so the lock in the repository always matches the latest release. This
   commit also keeps GitHub from disabling the scheduled workflows, which it
   does after 60 days without activity in a public repository.
6. It opens an issue listing anything held back or kept at an old pin.

A weekly job (`.github/workflows/staleness.yml`) opens an issue when the
latest release is more than 35 days old, and asks GitHub to keep both
scheduled workflows enabled.

Each release contains `hayaa-list-<serial>.bin.gz`, `hayaa-list-<serial>.txt`,
`starter.bin`, `manifest.json`, `manifest.json.sig`, `build-info.json` (per
source counts and held-back entries, for the next build), the
`sources.lock.json` it was built from, `LICENSE` and `CREDITS.md`. The file
formats, the matching rule and the manifest are described in
[docs/FORMAT.md](docs/FORMAT.md).

## Reporting a site

Use the issue forms on GitHub:

- **A site is blocked that should not be.** Give the address and what the
  site is. If the report is right, the site goes on the allowlist with a
  reason, and the fix ships in the next release.
- **An adult site is missing.** Give the address. Every report is checked by
  hand before it is added to `data/additions.txt`.

Issues are public. If you would rather not post an adult site's address in
public, email it to **support@hayaa.io** instead. Nothing is added or
removed automatically because of a report.

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

## Repository setup

A checklist for whoever sets up or moves this repository. The release job
refuses to run without these.

1. **Signing key.** Create the key pair on a trusted machine
   ([keys/README.md](keys/README.md)) and commit `keys/k1.pub.pem`.
2. **`release` environment** (Settings, Environments):
   - Deployment branches: selected branches only, `main`.
   - Required reviewers: at least one maintainer.
   - Environment secret `LIST_SIGNING_KEY`: the PEM private key.
3. **Pushing the lock.** The release job pushes one commit to `main` as
   `github-actions[bot]`. If `main` is protected, allow that (for example by
   adding GitHub Actions to the bypass list of the ruleset), or the release
   is published but the job reports the missing commit.
4. **Actions** (Settings, Actions, General): Actions enabled; workflow
   permissions may stay read-only, since each job asks for what it needs.
5. **Issues** enabled, with the labels `wrongly listed` and `missing site`.
6. **Tranco list.** The build uses the list ID in `src/config.ts`
   (`TRANCO_LIST_ID`). TODO: create a custom Tranco list that leaves out
   Cloudflare Radar (CC BY-NC 4.0), then change that one line; the next run
   re-pins it. See CREDITS.md.

## Repository layout

| Path | Contents |
|---|---|
| `src/` | The build: formats, parsing, gates, manifest, signing; `config.ts` holds every tunable |
| `scripts/` | `update-lock`, `fetch-previous`, `check-serial`, `sign` (local only), `verify` |
| `data/` | Hand-kept files, each documented at its top |
| `keys/` | Public keys for release signatures |
| `test/` | Tests, including the shared format fixtures |
| `sources.lock.json` | Pinned inputs, matching the latest release |
