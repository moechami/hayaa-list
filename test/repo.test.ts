// Invariants of the repository itself: the release workflow's safety
// properties, the reporting templates, licence statements, and the reviewed
// decisions recorded in data/. These are plain text checks, so a later edit
// that drops one of them fails here before it reaches a release.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { readDataLines } from '../src/parse'

const ROOT = join(__dirname, '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const lines = (p: string): string[] => readDataLines(read(p))

/** The text of one job in a workflow (from its "  name:" key to the next job). */
const job = (yml: string, name: string): string => {
  const start = yml.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} not found`)
  const rest = yml.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

describe('monthly release workflow', () => {
  const yml = read('.github/workflows/monthly.yml')
  const build = job(yml, 'build')
  const release = job(yml, 'release')

  test('every action is pinned to a full commit SHA', () => {
    for (const wf of readdirSync(join(ROOT, '.github/workflows'))) {
      for (const m of read(`.github/workflows/${wf}`).matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${wf}: ${m[1]}`)
    }
  })

  test('the release job runs from main only, in the protected environment', () => {
    assert.match(release, /\n {4}if: github\.ref == 'refs\/heads\/main'\n/)
    assert.match(release, /\n {4}environment: release\n/)
    assert.doesNotMatch(build, /secrets\./)
  })

  test('signs with OpenSSL from the environment, never a key file, then verifies twice', () => {
    assert.match(release, /openssl dgst -sha256 -sign <\(printf '%s\\n' "\$LIST_SIGNING_KEY"\) -out release\/manifest\.json\.sig release\/manifest\.json/)
    assert.doesNotMatch(yml, /npm run sign/)
    assert.doesNotMatch(yml, /echo "\$LIST_SIGNING_KEY"|LIST_SIGNING_KEY" >|key\.pem/)
    assert.match(release, /openssl dgst -sha256 -verify "keys\/\$key_id\.pub\.pem"/)
    assert.match(release, /npm run verify -- --dir release/)
    const sign = release.indexOf('-sign <(')
    assert.ok(sign < release.indexOf('-verify "keys') && sign < release.indexOf('npm run verify') && release.indexOf('npm run verify') < release.indexOf('gh release create'))
  })

  test('compares against the previous release and checks the serial against every release', () => {
    assert.match(build, /npm run fetch-previous -- --repo "\$GITHUB_REPOSITORY" --out previous/)
    assert.match(build, /npm run update-lock -- --fallback-lock previous\/sources\.lock\.json --notes notes\/lock\.txt/)
    assert.match(build, /npm run build -- --previous previous/)
    assert.match(build, /npm run build -- --out dist-repro --previous previous/)
    assert.match(build, /starter\.bin manifest\.json build-info\.json; do/)
    assert.match(release, /npm run check-serial -- --repo "\$GITHUB_REPOSITORY" --serial "\$SERIAL"/)
  })

  test('every release carries LICENSE, CREDITS.md and build-info.json', () => {
    const publish = release.slice(release.indexOf('gh release create'))
    for (const f of ['release/LICENSE', 'release/CREDITS.md', 'release/build-info.json', 'release/sources.lock.json', 'release/manifest.json.sig']) {
      assert.ok(publish.includes(f), f)
    }
    assert.match(build, /cp sources\.lock\.json LICENSE CREDITS\.md release\//)
  })

  test('records the lock on main after publishing (keep-alive), and reports what needs review', () => {
    const record = release.indexOf('Record the release')
    assert.ok(record > release.indexOf('gh release create'))
    assert.match(release, /cp release\/sources\.lock\.json sources\.lock\.json/)
    assert.match(release, /git push origin HEAD:main/)
    assert.match(job(yml, 'report-review'), /gh issue create/)
    assert.match(job(yml, 'report-failure'), /if: failure\(\)/)
  })
})

describe('staleness workflow', () => {
  const yml = read('.github/workflows/staleness.yml')

  test('weekly, opens an issue past 35 days, keeps the schedules enabled', () => {
    assert.match(yml, /cron: '[0-9]+ [0-9]+ \* \* [0-6]'/)
    assert.match(yml, /MAX_AGE_DAYS: 35/)
    assert.match(yml, /gh issue create/)
    assert.match(yml, /gh workflow enable monthly\.yml/)
    assert.match(yml, /HTTP 404/) // no release yet is not an error, any other API failure is
  })
})

describe('reporting and licences', () => {
  test('the issue forms offer private reporting by email', () => {
    const dir = join(ROOT, '.github/ISSUE_TEMPLATE')
    for (const f of ['wrongly-listed.yml', 'missing-site.yml', 'config.yml']) {
      assert.ok(existsSync(join(dir, f)), f)
      assert.match(read(`.github/ISSUE_TEMPLATE/${f}`), /support@hayaa\.io/, f)
    }
    assert.match(read('README.md'), /support@hayaa\.io/)
  })

  test('the list data is GPL-3.0-only, the code GPL-3.0-or-later', () => {
    assert.equal(JSON.parse(read('package.json')).license, 'GPL-3.0-or-later')
    for (const doc of ['README.md', 'CREDITS.md']) assert.match(read(doc), /GPL-3\.0-only/, doc)
    assert.match(read('README.md'), /GPL-3\.0-or-later/)
  })

  test('the README says the starter list is static and the release is attempted monthly', () => {
    const readme = read('README.md')
    assert.match(readme, /only when the app is updated/)
    assert.match(readme, /attempts a release on the 1st of every month/)
    assert.match(readme, /held back/)
  })
})

describe('reviewed decisions in data/', () => {
  const reviewed = new Set(lines('data/reviewed-top-hits.txt'))
  const allow = new Set(lines('data/allowlist.txt'))
  const subs = new Set(lines('data/reviewed-top-site-subdomains.txt'))

  test('borderline sites decided as adult are reviewed (blocked)', () => {
    for (const h of ['janitorai.com', 'polybuzz.ai', 'crushon.ai', 'spicychat.ai', 'seaart.ai', 'ome.tv', '4chan.org']) {
      assert.ok(reviewed.has(h), h)
      assert.ok(!allow.has(h), h)
    }
  })

  test('borderline sites decided as not adult are allowlisted (fc2.com root only)', () => {
    for (const h of ['character.ai', 'furaffinity.net', 'boosty.to', 'tango.me', 'fc2.com', 'mangago.me', 'manhwaweb.com', 'gaymuslims.com.au']) {
      assert.ok(allow.has(h), h)
      assert.ok(!reviewed.has(h), h)
    }
    assert.ok(!allow.has('*.fc2.com'))
  })

  test('gore and unverified Islamic-named entries are removed', () => {
    for (const h of ['forogore.net', 'bicaramuslim.com', 'czechmuslims.com', 'halalaschool.com', 'halalmovies.com']) assert.ok(allow.has(h), h)
    assert.ok(!reviewed.has('forogore.net'))
    assert.match(read('data/allowlist.txt'), /halalmovies\.com +# not verified adult; Islamic-named, reviewed by hand before re-adding/)
  })

  test('the subdomain false positives found by the audit are allowlisted', () => {
    for (const h of [
      'm.vk.com', 'my.mail.ru', 'articulo.mercadolibre.com.co', 'blogs.icrc.org', 'en.academic.ru', 'medicine.academic.ru',
      'feedback.miui.com', 'yunqi.qq.com', 'olhares.sapo.pt', 'blog-imgs-63.fc2.com', 'video-preview.s3.yandex.net',
      'gs.yandex.com.tr', 'paparazzo.globo.com', 'p.badoo.com', 'rating.kinopoisk.ru', 'policies.tinder.com',
      'support.afrointroductions.com', 'lutherandifference.libsyn.com', 'elevatedrecovery.libsyn.com',
      'brainsciencepodcast.libsyn.com', 'skepticzone.libsyn.com',
    ]) {
      assert.ok(allow.has(h), h)
    }
  })

  test('the negatives\' domains are allowlisted with everything under them (reddit.com and x.com root only)', () => {
    for (const n of lines('data/negatives.txt')) {
      const host = n.split(/\s+/)[0]
      const rootOnly = host === 'reddit.com' || host === 'x.com'
      const covered = [...allow].some((a) => a.startsWith('*.') && (host === a.slice(2) || host.endsWith(a.slice(1))))
      assert.ok(rootOnly ? allow.has(host) : covered, host)
    }
  })

  test('the adult sites only the old bundled list had are additions', () => {
    const additions = new Set(lines('data/additions.txt'))
    for (const h of ['adultfuns.club', 'gays-cruising.com', 'garotocomlocal.com.br', 'erotikchat4free.org', 'hentaivietsub.com', 'gaym.com', 'pcmax.jp']) {
      assert.ok(additions.has(h), h)
    }
  })

  test('class rules in the subdomain review are only for platforms of independent sites', () => {
    const classes = [...subs].filter((s) => s.startsWith('*.'))
    assert.deepEqual(classes.sort(), [
      '*.b-cdn.net', '*.cdn.ampproject.org', '*.deviantart.com', '*.disqus.com', '*.free.fr', '*.itch.io', '*.livejournal.com',
      '*.medium.com', '*.mybluehost.me', '*.squarespace.com', '*.tumblr.com', '*.weebly.com', '*.wix.com', '*.wordpress.com',
    ])
  })
})
