# Release signing keys

Public keys that verify `manifest.json.sig`, one file per key id:
`<keyId>.pub.pem` (EC P-256, PEM SubjectPublicKeyInfo). The manifest's
`keyId` field names the key that signed it.

`k1.pub.pem` is not here yet: it is added when the repository is set up,
from a key pair made as below. Until then the release job cannot verify a
signature and publishes nothing.

The private key is never stored in this repository, nor on the build
machine's disk. The release workflow reads it from the `LIST_SIGNING_KEY`
secret of the `release` environment and hands it straight to OpenSSL
through process substitution:

```
openssl dgst -sha256 -sign <(printf '%s\n' "$LIST_SIGNING_KEY") -out manifest.json.sig manifest.json
```

It then verifies the signature twice, with OpenSSL against
`keys/<keyId>.pub.pem` and with the Node verifier that runs every check the
app runs (`npm run verify`). `npm run sign` exists for local trials with a
throwaway key only.

## Setup checklist

1. On a trusted machine, outside the repository, create the key pair:

   ```
   openssl ecparam -name prime256v1 -genkey -noout -out k1.key.pem
   openssl ec -in k1.key.pem -pubout -out k1.pub.pem
   ```

2. Commit only `k1.pub.pem`, here, as `keys/k1.pub.pem`. The app must
   trust the same public key (its key list) before any release is useful.
3. In the repository settings, create the environment `release`:
   - Deployment branches and tags: selected branches only, `main`.
   - Required reviewers: at least one maintainer, so every release is
     approved by a person.
   - Environment secret `LIST_SIGNING_KEY`: the full contents of
     `k1.key.pem`.
4. Store `k1.key.pem` offline (for example an encrypted backup) and delete
   every other copy. Anyone holding it can sign a list the app will install.

## Rotation

Add `k2.pub.pem`, ship an app release that trusts both keys, switch the
workflow to `k2` (`HAYAA_LIST_KEY_ID`) and its secret, then retire `k1`.
