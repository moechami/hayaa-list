# The Hayaa List

An open blocklist of adult websites. It is used by the Hayaa app's Android
Blocker from version 2.0.2, to block adult sites in the browser.

The full list holds about 1.1 million hosts. A listed host also covers its
subdomains. The list can also hold page-level entries (an adult section of
an otherwise ordinary site); there are none yet.

Two lists are published:

- **The full list** (`hayaa-list-<serial>.bin.gz`): every entry, including
  the mirror and proxy (bypass) domains its sources list and any page-level
  entries, updated by a monthly release. The app downloads it over the air.
- **The starter list** (`starter.bin`): exactly 50 hosts, the best-known
  dedicated adult sites with at most two domains per brand, host entries
  only. It is deliberately small. The app ships it inside the app itself,
  so it changes only when the app is updated, never over the air.

## Licences

- **The list data** is licensed under the GNU General Public License,
  **version 3 only** (`GPL-3.0-only`): every file attached to a release
  (the binary and text lists, `starter.bin`, the manifest and its
  metadata), the hand-kept files in `data/`, and `sources.lock.json`. Two
  of its sources, HaGeZi and oisd, publish the version 3 text without an
  "or later" grant, so the combined list cannot offer later versions.
- **The code in this repository** (`src/`, `scripts/`, `test/`, the
  workflows) is licensed under the GNU General Public License, version 3 or
  (at your option) any later version (`GPL-3.0-or-later`), as `package.json`
  states.

**Modification notice** (GPL-3.0 section 5(a)): this list merges,
normalises and filters the source lists named below; each release's date is
its serial (`YYYYMMDDNN`).

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
5. Apply the **protected-name gate**, remove **false keyword matches** and
   **ordinary names**, and hold back **education and government hosts**
   (below).
6. Remove allowlisted hosts (`data/allowlist.txt`).
7. Apply the review gates (below), holding back new unreviewed popular
   entries.
8. Drop hosts that a listed parent domain already covers.
9. Write the binary list, its gzip, a plain-text copy, the starter list,
   the manifest and `build-info.json` to `dist/`.

### Protected-name gate

The app's users cannot override the Blocker, and the app exists for
recovery from pornography in an Islamic setting, so blocking a recovery,
religious, health or abuse-support site is worse than missing an adult
one. Any listed host whose name (every label except the public suffix,
hyphens ignored) contains a protected term is **removed**, unless a person
reviewed it as genuinely adult and named it, with the reason, in
`data/reviewed-protected.txt`. The terms are data, in
`data/protected-terms.txt`: words of recovery (recover, rehab, addict,
sober, nofap, therapy, counsel, integrity, "overcome" or "conquer" together
with porn, "anonymous" together with porn, sex or addict, and the names of
known recovery projects), of sexual health and abuse support (sexual
health, sexual abuse, sexual assault, sexual harassment, helplines,
gynecology, urology), of Christianity (church, bible, christ, gospel,
ministry, jesus, prayer, sermon, faith, parish, diocese, catholic,
lutheran, baptist, methodist, evangelical), of Judaism (jewish) and of
Islam (muslim, islam, quran, halal, masjid, deen, imam, allah, sunna,
hadith, hijab, salah, tauhid, madrasa, umrah, hajj, hijrah, majlis, the
label "dua", and more). A term can name the ordinary words it must not be
read inside ("prayer" is not read inside "sprayer", "parish" not inside
"Paris Hilton"). Every host under a religious top-level domain (`.church`,
`.christmas`, `.catholic`, `.bible`, `.mormon`) is protected the same
way. Known recovery, religious, health and support sites are also
allowlisted by name.

### False keyword matches

The Block List Project built its list partly by matching words such as
"sex" inside names, which also caught Essex, Sussex, the surname Sexton and
"homes exteriors", "news express" and "unisex salon". For hosts that only
that source lists, `data/keyword-false-matches.txt` names the non-sexual
words, safe words and the sexual-looking substrings: a host with a
non-sexual word is removed when every sexual-looking token in it starts
inside a non-sexual or safe word ("sussextiles": the "sext" starts inside
"sussex"; "sussexphotobooth": the "hot" is inside "photo"). Safe words only
hide short tokens such as "hot", "cam", "ass" and "tit"; they never make a
host removable on their own.

### Ordinary names

Every source lists some ordinary sites: expired domains, sites that once
carried an adult advert, and names a list caught by mistake. A host whose
name reads as an ordinary business, school, sport or gambling site (golf,
academy, software, bank, casino, steel, newspaper and similar, in several
languages) and has no adult-looking word anywhere in it is **removed**.
The words are data, in `data/ordinary-names.txt`; the adult-looking list is
deliberately broad ("hot", "girl", "video", "chat", "18"), so one such word
keeps a host listed. Hosts a person reviewed as adult are never removed by
this rule.

### Education and government hosts

A listed host under an education or government suffix of the Public Suffix
List (`edu`, `gov`, `mil`, `ac.uk`, `sch.id`, `k12.tr`, `gob.mx`,
`gouv.fr`, `go.jp`, `nhs.uk` and similar; `src/edugov.ts`) is **held
back**: left out of the release, recorded in `build-info.json` and listed
in the review issue, until a person reviews it as genuinely adult into
`data/reviewed-edu-gov.txt`. This holds even for an entry the previous
release listed. Schools, universities, ministries and health services are
almost never adult sites; a listed one is usually a hijacked or spammed page
or a name that happens to contain a word (`xxx.lanl.gov` was the arXiv
preprint server).

### Review gates

Popular sites need a person's review before the list blocks them:

- **Top sites.** A site in the top 10,000 of the pinned Tranco ranking
  must be named in `data/reviewed-top-hits.txt` (genuinely adult) or in
  `data/allowlist.txt` (a mistake, with a reason).
- **Subdomains of the top 10,000 sites.** A listed host such as `m.vk.com`
  leaves `vk.com` itself reachable but would still break it for most people,
  so every listed subdomain of a top-10,000 site must be covered by
  `data/reviewed-top-site-subdomains.txt` (a host, or a `*.` rule for
  platforms where each subdomain is a separate person's site and a sample
  was mostly explicit, such as `*.tumblr.com`) or allowlisted.

An unreviewed entry that the previous release already listed stays listed.
A new one is **held back**: it is left out of this release, recorded in
`build-info.json` and listed in an issue, and it waits there, month after
month, until someone reviews it. The release still ships. Only a burst of
more than 25 new entries at once, which suggests a broken or poisoned
upstream list, stops the release. Entries a person has looked at and left
undecided go in `data/pending-review.txt`: they stay held back without
counting toward that limit (the itch.io pages, for example, whose sample
was mostly ordinary game developers).

### Other gates

The build fails, and nothing is published, if any of these fails:

- the binary list does not pass full validation, or does not decode back to
  exactly the entries that went in;
- a canary (`data/canaries.txt`, well-known adult sites) does not match, or a
  negative (`data/negatives.txt`, popular ordinary sites) does, or a
  negative is not on the allowlist;
- shrinkage: compared with the previous release, the list lost more than
  10% of its hosts or one source lost more than 30% of its own; or the list
  is more than 10% below the largest of the last six releases (so it cannot
  shrink slowly, a few percent a month); or it is below an absolute floor of
  900,000 hosts (`src/config.ts`);
- growth: compared with the previous release, the list grew more than 15%,
  a source grew more than 30%, or a source added more than 50,000
  registrable domains the previous release did not list (a hijacked or
  broken upstream);
- more than 1% of a source's lines (and at least 100) cannot be read, which
  means its format changed;
- a hand-kept entry is a public suffix, or is both added and allowlisted, or
  an addition has a protected name without a review;
- the starter list does not have exactly 50 entries, takes more than two
  from one brand, includes a proxy or bypass site, or is not a strict subset
  of the full list;
- the manifest breaks a rule the app enforces.

The shrink and growth gates can be skipped for one release by the workflow
inputs `allow_shrink` and `allow_growth`, after a person has checked why;
the release notes say when either was used.

Building twice from the same inputs gives byte-identical files; the monthly
job checks this on every run.

```
npm ci
npm run build                       # writes dist/, compares with the build already in dist/
npm run build -- --previous none    # compares with nothing
npm test
```

Node.js 22 or later. The build needs network access only to fetch the pinned
inputs, which it caches in `.cache/`. `dist/` also gets review aids that are
never published: `review-top-site-subdomains.txt` (every listed subdomain of
the top 10,000 sites), `removed-protected.txt` and
`removed-keyword-false-matches.txt`.

## Releases

A scheduled job attempts a release on the 1st of every month
(`.github/workflows/monthly.yml`):

1. It downloads the previous release and checks the signatures of its
   manifest, `build-info.json` and `sources.lock.json` against the keys in
   `keys/`. The previous host set is decoded from the signed list file, never
   read from the unsigned plain-text copy. With no release yet it compares
   against nothing; any other GitHub API error, a missing file or a bad
   signature stops the job.
2. It re-pins every source that is not frozen to its latest commit. A
   source whose repository or file has disappeared, whose licence file
   changed, or whose repository is no longer the pinned one (another GitHub
   repository id or name: renamed, redirected, or deleted and recreated),
   keeps the pin it had in the previous release; an issue says so and the
   release still ships. A changed licence is accepted only after a person
   has read it (`npm run update-lock -- --accept-license-change`).
3. It runs the type check and every test, builds, builds again to check the
   bytes are identical, and runs every gate.
4. A separate job, from `main` only and in the protected `release`
   environment (a person approves it), signs `manifest.json`,
   `build-info.json` and `sources.lock.json` with OpenSSL. That job runs
   nothing but OpenSSL; the build never sees the key.
5. A third job, without the key, checks the files are the ones the build
   made, verifies every signature with OpenSSL and with every check the app
   runs, and publishes a GitHub release tagged `v<serial>`. Its steps that
   hold a GitHub token run only `gh` and `jq`, never code from npm.
6. From `main` only, it opens an issue listing anything new that was held
   back or kept at an old pin, and any gate override used, even when signing
   or publishing failed. Text from upstream is reduced to safe characters
   and capped before it reaches an issue. Gate overrides are also recorded
   in the signed `build-info.json`, the run summary and the release notes.

Nothing is committed to the repository by these jobs: each release carries
the `sources.lock.json` it was built from, and the next build starts from
that one. A weekly job (`.github/workflows/staleness.yml`) opens an issue
when the latest release is more than 35 days old, and keeps both scheduled
workflows enabled (GitHub disables them after 60 days without activity in a
public repository).

Each release contains `hayaa-list-<serial>.bin.gz`, `hayaa-list-<serial>.txt`,
`starter.bin`, `manifest.json` and `manifest.json.sig`, `build-info.json`
and `build-info.json.sig` (per source counts, the recent host counts and
held-back entries, for the next build), the `sources.lock.json` it was built
from and `sources.lock.json.sig`, `LICENSE` and `CREDITS.md`. The file
formats, the matching rule and the manifest are described in
[docs/FORMAT.md](docs/FORMAT.md).

## Reporting a site

Use the issue forms on GitHub:

- **A site is blocked that should not be.** Give the address and what the
  site is. If the report is right, the site goes on the allowlist with a
  reason, and the correction is included in the next release.
- **An adult site is missing.** Give the address. Every report is checked by
  hand before it is added to `data/additions.txt`.

Issues are public. If you would rather not post an adult site's address in
public, email it to **support@hayaa.io** instead. Nothing is added or
removed automatically because of a report.

## Verifying a release

`manifest.json.sig` is an ECDSA P-256 signature over SHA-256 of the exact
bytes of `manifest.json` (and likewise for `build-info.json.sig` and
`sources.lock.json.sig`). The public keys are in `keys/`. With OpenSSL:

```
openssl dgst -sha256 -verify keys/k1.pub.pem -signature manifest.json.sig manifest.json
```

Then check that the SHA-256 of `hayaa-list-<serial>.bin.gz` equals
`file.gzSha256` in the manifest. To run every check the app runs (signature,
manifest rules, sizes and hashes, header, full validation, canaries and
negatives) and the other two signatures, put the release files in a folder
and run:

```
npm run verify -- --dir <folder> --release
```

## Repository setup

A checklist for whoever sets up or moves this repository. The release job
refuses to run without these.

1. **Signing key and the `release` environment**: follow the checklist in
   [keys/README.md](keys/README.md) (key made with a private umask, its
   fingerprint recorded, `keys/k1.pub.pem` committed; the environment limited
   to `main`, with a required reviewer, self-review prevented and no
   administrator bypass; actions required to be pinned to a full commit SHA;
   immutable releases turned on).
2. **Actions** (Settings, Actions, General): Actions enabled; workflow
   permissions may stay read-only, since each job asks for what it needs.
3. **Issues** enabled, with the labels `wrongly listed` and `missing site`.
4. **Tranco list.** The build uses the list ID in `src/config.ts`
   (`TRANCO_LIST_ID`). TODO: create a custom Tranco list that leaves out
   Cloudflare Radar (CC BY-NC 4.0), then change that one line; the next run
   re-pins it. See CREDITS.md.

## Repository layout

| Path | Contents |
|---|---|
| `src/` | The build: formats, parsing, gates, name rules, manifest, signing; `config.ts` holds every tunable |
| `scripts/` | `update-lock`, `fetch-previous`, `check-serial`, `issue-body`, `sign` (local trials only), `verify` |
| `data/` | Hand-kept files, each documented at its top |
| `keys/` | Public keys for release signatures, and the key setup checklist |
| `test/` | Tests, including the shared format fixtures |
| `sources.lock.json` | The pins a build starts from (repository ids included); each release carries the exact lock it was built from |
