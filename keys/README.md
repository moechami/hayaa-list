# Release signing keys

Public keys that verify a release's signatures, one file per key id:
`<keyId>.pub.pem` (EC P-256, PEM SubjectPublicKeyInfo). The manifest's
`keyId` field names the key that signed it.

Three files of every release are signed: `manifest.json` (what the app
verifies), and `build-info.json` and `sources.lock.json` (what the next
monthly build trusts: the previous host counts, held-back entries and
source pins). The next build checks all three against the keys here before
it uses anything from the previous release.

`k1.pub.pem` was made on 2026-11-09, as below. Its fingerprint (SHA-256 of
the DER public key) is
`d2de9f1da2747a343de2ce1f7b2cb0dcfd304eb2a59e1b1d886bd993ddaaa6c7`; check it
wherever the key is copied.

The private key is never stored in this repository, nor on the build
machine's disk. Only the workflow's `sign` job sees it: that job runs
OpenSSL and nothing else (no checkout, no npm, no GitHub token), reading the
key from the `LIST_SIGNING_KEY` secret of the `release` environment and
handing it straight to OpenSSL through process substitution:

```
openssl dgst -sha256 -sign <(printf '%s\n' "$LIST_SIGNING_KEY") -out manifest.json.sig manifest.json
```

The `publish` job, which never sees the key, then verifies every signature
with OpenSSL against `keys/<keyId>.pub.pem` and with the Node verifier that
runs every check the app runs (`npm run verify -- --release`), and only
then creates the release. `npm run sign` exists for local trials with a
throwaway key only, and refuses a key whose public half is in this folder
unless given `--force`.

## Setup checklist

1. On a trusted machine, outside the repository, with a private umask so
   the key file is never readable by anyone else, create the key pair:

   ```
   umask 077
   openssl ecparam -name prime256v1 -genkey -noout -out k1.key.pem
   openssl ec -in k1.key.pem -pubout -out k1.pub.pem
   ```

2. Record the public key's fingerprint, and check it again wherever the key
   is copied (here, and the app's trusted key list):

   ```
   openssl pkey -pubin -in k1.pub.pem -outform DER | openssl dgst -sha256
   ```

3. Commit only `k1.pub.pem`, here, as `keys/k1.pub.pem`. The app must
   trust the same public key (its key list) before any release is useful.
4. In the repository settings, create the environment `release`:
   - Deployment branches and tags: selected branches only, `main`.
   - Required reviewers: at least one maintainer, so every release is
     approved by a person.
   - Prevent self-review: on, so the person who started a run cannot also
     approve it, once the repository has a second maintainer. While it has
     one, leave it off, or no run could ever be approved (a scheduled run
     counts as started by whoever last changed the workflow).
   - Allow administrators to bypass: off.
   - Environment secret `LIST_SIGNING_KEY`: the full contents of
     `k1.key.pem`.
5. In the repository settings (Actions, General), require actions to be
   pinned to a full-length commit SHA. Every workflow here already is, and
   a test checks it.
6. Turn on immutable releases (Settings, General, Releases), so a published
   release's files and tag can never be changed or replaced afterwards: the
   next build trusts the previous release's signed files.
7. Store `k1.key.pem` offline (for example an encrypted backup) and delete
   every other copy. Anyone holding it can sign a list the app will install.

## Rotation

Add `k2.pub.pem`, ship an app release that trusts both keys, switch the
workflow to `k2` (`HAYAA_LIST_KEY_ID`) and its secret, then retire `k1`.
Keep `k1.pub.pem` here until a release signed with `k2` exists: the next
build checks the previous release with every key in this folder.
