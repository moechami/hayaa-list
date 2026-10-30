# Release signing keys

Public keys that verify `manifest.json.sig`, one file per key id:
`<keyId>.pub.pem` (EC P-256, PEM SubjectPublicKeyInfo). The manifest's
`keyId` field names the key that signed it.

The private key is never stored in this repository. The release workflow
reads it from the `LIST_SIGNING_KEY` secret of the `release` environment.

Creating a key pair (on a trusted machine, outside the repository):

```
openssl ecparam -name prime256v1 -genkey -noout -out k1.key.pem
openssl ec -in k1.key.pem -pubout -out k1.pub.pem
```

Commit only `k1.pub.pem` here. Rotation: add `k2.pub.pem`, ship an app
release that trusts both keys, switch the workflow to `k2`
(`HAYAA_LIST_KEY_ID`), then retire `k1`.
