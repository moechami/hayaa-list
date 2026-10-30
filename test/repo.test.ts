// SPDX-License-Identifier: GPL-3.0-or-later
//
// Invariants of the repository itself: the release workflow's safety
// properties, the reporting templates, licence statements, and the reviewed
// decisions recorded in data/. These are plain text checks, so a later edit
// that drops one of them fails here before it reaches a release.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
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
  const sign = job(yml, 'sign')
  const publish = job(yml, 'publish')
  const review = job(yml, 'report-review')

  test('every action is pinned to a full commit SHA', () => {
    for (const wf of readdirSync(join(ROOT, '.github/workflows'))) {
      for (const m of read(`.github/workflows/${wf}`).matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${wf}: ${m[1]}`)
    }
  })

  test('only the sign job sees the key: from main, in the protected environment, with no permissions', () => {
    assert.match(sign, /\n {4}if: github\.ref == 'refs\/heads\/main'\n/)
    assert.match(sign, /\n {4}environment: release\n/)
    assert.match(sign, /\n {4}permissions: \{\}\n/)
    assert.match(publish, /\n {4}if: github\.ref == 'refs\/heads\/main'\n/)
    for (const other of [build, publish, review, job(yml, 'report-failure')]) assert.doesNotMatch(other, /secrets\.|LIST_SIGNING_KEY/)
    assert.equal((yml.match(/secrets\./g) ?? []).length, 1)
  })

  test('the sign job runs OpenSSL and nothing else: no checkout, no npm or tsx, no token', () => {
    for (const forbidden of [/actions\/checkout/, /\bnpm\b/, /\bnpx\b/, /\btsx\b/, /\bnode\b/, /github\.token|GITHUB_TOKEN|GH_TOKEN/, /\bgh /]) {
      assert.doesNotMatch(sign, forbidden)
    }
    assert.match(sign, /for f in manifest\.json build-info\.json sources\.lock\.json; do/)
    assert.match(sign, /openssl dgst -sha256 -sign <\(printf '%s\\n' "\$LIST_SIGNING_KEY"\) -out "signatures\/\$f\.sig" "release\/\$f"/)
    assert.doesNotMatch(yml, /npm run sign/)
    assert.doesNotMatch(yml, /echo "\$LIST_SIGNING_KEY"|LIST_SIGNING_KEY" >|key\.pem/)
  })

  test('the publish job, without the key, checks the serial and verifies every signature twice before publishing', () => {
    assert.match(publish, /needs: \[build, sign\]/)
    assert.match(publish, /test "\$\(node -p "require\('\.\/release\/manifest\.json'\)\.serial"\)" = "\$SERIAL"/)
    assert.match(publish, /gh api --paginate "repos\/\$GITHUB_REPOSITORY\/releases\?per_page=100" --jq '\.\[\]\.tag_name'/)
    assert.match(publish, /for f in manifest\.json build-info\.json sources\.lock\.json; do\n\s+openssl dgst -sha256 -verify "keys\/\$key_id\.pub\.pem" -signature "release\/\$f\.sig" "release\/\$f"/)
    assert.match(publish, /npm run verify -- --dir release --release/)
    const at = (s: string): number => publish.indexOf(s)
    assert.ok(at('= "$SERIAL"') < at('-verify "keys') && at('-verify "keys') < at('npm run verify') && at('npm run verify') < at('gh release create'))
  })

  test('the publish job runs no npm, npx, tsx or node code in a step that holds its contents: write token', () => {
    assert.match(publish, /\n {4}permissions:\n {6}contents: write\n/)
    assert.doesNotMatch(publish, /npm run check-serial/)
    const steps = publish.split(/\n {6}- /).slice(1)
    const withToken = steps.filter((s) => /github\.token|GITHUB_TOKEN|GH_TOKEN/.test(s))
    assert.equal(withToken.length, 2) // the serial re-check and the release itself
    for (const s of withToken) assert.doesNotMatch(s, /\bnpm\b|\bnpx\b|\btsx\b|\bnode\b/, s.split('\n', 1)[0])
    // The job-level env carries no token either.
    assert.doesNotMatch(publish.slice(0, publish.indexOf('steps:')), /token|TOKEN/)
  })

  test('the publish job\'s serial re-check (bash, gh and jq) passes a newer serial and refuses an older one or an API error', () => {
    const step = publish.split(/\n {6}- /).find((s) => s.includes('gh api --paginate'))!
    const script = step.slice(step.indexOf('run: |') + 'run: |'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
    const dir = mkdtempSync(join(tmpdir(), 'hayaa-list-serial-'))
    try {
      // A fake gh: prints the tags in $FAKE_TAGS, or fails when $FAKE_FAIL is set.
      writeFileSync(join(dir, 'gh'), '#!/bin/bash\nif [ -n "$FAKE_FAIL" ]; then echo "HTTP 500" >&2; exit 1; fi\nprintf "%s" "$FAKE_TAGS"\n', { mode: 0o755 })
      const run = (serial: string, tags: string, fail = false): number | null =>
        spawnSync('bash', ['-c', script], {
          env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, SERIAL: serial, FAKE_TAGS: tags, FAKE_FAIL: fail ? '1' : '', GITHUB_REPOSITORY: 'o/r' },
          encoding: 'utf8',
        }).status
      assert.equal(run('2026110101', ''), 0) // no release yet
      assert.equal(run('2026120101', 'v2026110101\nv2026100101\nnotes\n'), 0)
      assert.equal(run('2026110101', 'v2026110101\n'), 1) // not newer
      assert.equal(run('2026110101', 'v2026090101\nv2026120101\n'), 1) // every tag counts, not the first
      assert.equal(run('2026110101', '', true), 1) // an API error never passes
      assert.equal(run('202611010', ''), 1)
      assert.equal(run('9999999999', ''), 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('nothing is committed to main: no checkout history, no push, no recorded lock', () => {
    assert.doesNotMatch(yml, /fetch-depth/)
    assert.doesNotMatch(yml, /git push|git commit|gh auth setup-git|contents: write[\s\S]*Record/)
    assert.doesNotMatch(yml, /cp release\/sources\.lock\.json sources\.lock\.json/)
  })

  test('compares against the signed previous release and checks the serial against every release', () => {
    assert.match(build, /npm run fetch-previous -- --repo "\$GITHUB_REPOSITORY" --out previous/)
    assert.match(build, /npm run update-lock -- --fallback-lock previous\/sources\.lock\.json --notes notes\/lock\.txt/)
    assert.match(build, /npm run build -- --previous previous\n/)
    assert.match(build, /npm run build -- --out dist-repro --previous previous/)
    assert.match(build, /starter\.bin manifest\.json build-info\.json; do/)
    assert.match(build, /npm run check-serial -- --repo "\$GITHUB_REPOSITORY" --serial "\$SERIAL"/)
  })

  test('every release carries the signed files, LICENSE and CREDITS.md', () => {
    const create = publish.slice(publish.indexOf('gh release create'))
    for (const f of [
      'release/LICENSE', 'release/CREDITS.md', 'release/build-info.json', 'release/build-info.json.sig', 'release/sources.lock.json',
      'release/sources.lock.json.sig', 'release/manifest.json', 'release/manifest.json.sig', 'release/starter.bin',
    ]) {
      assert.ok(create.includes(f), f)
    }
    assert.match(build, /cp sources\.lock\.json LICENSE CREDITS\.md release\//)
  })

  test('gate overrides are workflow inputs and are shown in the release notes', () => {
    assert.match(yml, /\n {6}allow_shrink:\n/)
    assert.match(yml, /\n {6}allow_growth:\n/)
    assert.match(build, /HAYAA_LIST_ALLOW_SHRINK: \$\{\{ inputs\.allow_shrink && '1' \|\| '0' \}\}/)
    assert.match(build, /HAYAA_LIST_ALLOW_GROWTH: \$\{\{ inputs\.allow_growth && '1' \|\| '0' \}\}/)
    assert.match(publish, /Gate overrides used for this release: allow_shrink \$ALLOW_SHRINK, allow_growth \$ALLOW_GROWTH/)
    // The notes read them from the signed build-info.json, which must agree with the inputs.
    assert.match(publish, /ALLOW_SHRINK=\$\(jq -r 'if \.gateOverrides\.allowShrink then "yes" else "no" end' release\/build-info\.json\)/)
    assert.match(publish, /test "\$\(jq -r \.gateOverrides\.allowShrink release\/build-info\.json\)" = "\$INPUT_SHRINK"/)
    assert.match(publish, /test "\$\(jq -r \.gateOverrides\.allowGrowth release\/build-info\.json\)" = "\$INPUT_GROWTH"/)
    // And they are shown in the run summary and stated in the review issue.
    assert.match(build, /gateOverrides\.allowShrink[^\n]*gateOverrides\.allowGrowth[^\n]*dist\/build-info\.json >> "\$GITHUB_STEP_SUMMARY"/)
    assert.match(build, /--out notes\/issue-body\.md --build-info dist\/build-info\.json/)
  })

  test('review issues are opened even when a later job failed, from sanitised text only', () => {
    assert.match(review, /\n {4}if: always\(\) && github\.ref == 'refs\/heads\/main' && needs\.build\.result == 'success' && needs\.build\.outputs\.review != '0'\n/)
    assert.match(review, /needs: \[build, sign, publish\]/)
    assert.match(build, /npx --no-install tsx scripts\/issue-body\.ts --notes notes --out notes\/issue-body\.md/)
    assert.match(review, /cat notes\/issue-body\.md/)
    assert.doesNotMatch(review, /held-back\.txt|lock\.txt/) // never the raw notes
    assert.match(job(yml, 'report-failure'), /if: failure\(\)/)
  })
})

describe('staleness workflow', () => {
  const yml = read('.github/workflows/staleness.yml')

  test('weekly, opens an issue past 35 days, keeps the schedules enabled (the only keep-alive)', () => {
    assert.match(yml, /cron: '[0-9]+ [0-9]+ \* \* [0-6]'/)
    assert.match(yml, /MAX_AGE_DAYS: 35/)
    assert.match(yml, /gh issue create/)
    assert.match(yml, /gh workflow enable monthly\.yml/)
    assert.match(yml, /gh workflow enable staleness\.yml/)
    assert.match(yml, /actions: write/)
    assert.match(yml, /HTTP 404/) // no release yet is not an error, any other API failure is
  })
})

describe('repository hygiene', () => {
  test('.env files and private keys are never committed', () => {
    const ignore = lines('.gitignore')
    for (const p of ['.env', '*.pem', '!keys/*.pub.pem', '*.key']) assert.ok(ignore.includes(p), p)
  })

  test('the key checklist covers the protected environment, pinned actions and immutable releases', () => {
    const keys = read('keys/README.md')
    for (const re of [/umask 077/, /openssl pkey -pubin -in k1\.pub\.pem -outform DER \| openssl dgst -sha256/, /selected branches only, `main`/, /Required reviewers/, /Prevent self-review/, /Allow administrators to bypass: off/, /full-length commit SHA/, /immutable releases/]) {
      assert.match(keys, re)
    }
    assert.doesNotMatch(read('README.md'), /bypass list/)
  })

  test('src/format.ts stays byte-identical to the app\'s copy (no header is added here)', () => {
    const sha = createHash('sha256').update(readFileSync(join(ROOT, 'src/format.ts'))).digest('hex')
    assert.equal(sha, '214f4e340046ed3f3de4e4ddb6e03bdcd3522050b17133c38767eb0989a07968')
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

  test('licence and attribution statements the audit asked for', () => {
    const readme = read('README.md')
    assert.match(readme, /the hand-kept files in `data\/`, and `sources\.lock\.json`/)
    assert.match(readme, /Modification notice\*\* \(GPL-3\.0 section 5\(a\)\): this list merges,\nnormalises and filters/)
    assert.match(readme, /used by the Hayaa app's Android\nBlocker from version 2\.0\.2/)
    assert.match(readme, /### Protected-name gate/)
    const credits = read('CREDITS.md')
    assert.match(credits, /Copyright \(c\) Clefspeare13 pornhosts contributors/)
    assert.match(credits, /Copyright \(c\) The Block List Project contributors/)
    assert.match(credits, /Modification notice\*\* \(GPL-3\.0 section 5\(a\)\)/)
  })

  test('FORMAT.md: starter serial 0, the size range, and the hyphen rule readers must not apply', () => {
    const format = read('docs/FORMAT.md')
    assert.match(format, /header\nserial \*\*0\*\*/)
    assert.match(format, /32 bytes to 96 MiB/)
    assert.match(format, /HYPHEN_3_4/)
    assert.match(format, /build-info\.json\.sig/)
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

  test('class rules in the subdomain review are only for platforms of independent sites; never itch.io', () => {
    const classes = [...subs].filter((s) => s.startsWith('*.'))
    assert.deepEqual(classes.sort(), [
      '*.b-cdn.net', '*.blig.ig.com.br', '*.blogs.sapo.pt', '*.blogspot.com', '*.cdn.ampproject.org', '*.deviantart.com', '*.disqus.com',
      '*.free.fr', '*.hpg.ig.com.br', '*.livejournal.com', '*.medium.com', '*.mybluehost.me', '*.mystrikingly.com',
      '*.netfirms.com', '*.newgrounds.com', '*.ning.com', '*.over-blog.com', '*.paginas.sapo.pt', '*.rncdn7.com', '*.squarespace.com',
      '*.tumblr.com', '*.weebly.com', '*.wix.com', '*.wordpress.com',
    ])
    // canalblog and narod.ru sampled weak: pending, with their explicit pages reviewed one by one.
    const pendingLines = lines('data/pending-review.txt')
    for (const p of ['*.canalblog.com', '*.narod.ru']) assert.ok(pendingLines.includes(p), p)
    const canal = [...subs].filter((s) => s.endsWith('.canalblog.com') && !s.startsWith('*.'))
    const narod = [...subs].filter((s) => s.endsWith('.narod.ru') && !s.startsWith('*.'))
    assert.ok(canal.length > 900 && narod.length > 50, `${canal.length} ${narod.length}`)
    for (const h of [...canal, ...narod]) assert.match(h, /porn|xxx|sex|hentai|nsfw|milf|fuck|puss|dick|cock|tits|boob|escort|erot|salope|cochonne|baise|plan-?cul|godemich|masturb|branl|orgasm|sodomi|bdsm|fetis|fetich|domina|exhib|voyeur|libertin|echangis|candaul|beurette|shemale|tranny|gangbang|bukkake|nympho|soumise|esclave|cuckold|swing|creampie|blowjob|fellation|zoophil|incest|nude|naked|preteen|lolita|beastual|rape-|wife/, h)
    for (const h of ['homosexuel.canalblog.com', 'lespetitsoiseaux.canalblog.com', 'dsetsalopette.canalblog.com', 'conseilsexologie.canalblog.com', 'sexist.canalblog.com']) assert.ok(!subs.has(h), h)
    // itch.io pages are reviewed one by one; the rest wait in pending-review.
    assert.ok(lines('data/pending-review.txt').includes('*.itch.io'))
    assert.ok([...subs].some((s) => s.endsWith('.itch.io') && !s.startsWith('*.')))
  })

  test('the recovery, anti-porn and Islamic-named sites from the audit are allowlisted with everything under them', () => {
    for (const h of [
      'yourbrainonporn.com', 'realyourbrainonporn.com', 'pornaddictsanonymous.org', 'spaa-recovery.org', 'sca-recovery.org',
      'istoppornography.org', 'stopsexaddiction.org', 'endpornaddiction.com', 'restoringsexualpurity.org', 'fortworthpornrecovery.com',
      'biblicalpornrecovery.com', 'quitpornuse.com', 'sexaddictionhelp.com', 'pornaddictionawareness.org', 'sexualsobrietycoach.com',
      'nycenterforsexaddictiontreatment.com', 'fourcirclesrecovery.com', 'ldshopeandrecovery.com', 'theexodusroads.com',
      'feministantipornographymovement.org', 'nakedbiblepodcast.com', 'exodus-wallet.com', 'exodus.email', 'overthinkersguidetosex.substack.com',
      'ahappymuslimah.tumblr.com', 'ace-muslim.tumblr.com', 'muslimstateof-mind.tumblr.com', 'quranbeginners.com', 'areejquran.com',
      'rawdatelquran.com', 'qurank.net', 'profetadelislam.com', 'islamicquiz.xyz', 'islamic-wealth-management.net', 'islamicexpo-sa.com',
      'libyanislamicgroup.org', 'musliminchina.com', 'muslimwakeup.com', 'ukrhalal.org', 'imamsadr.net', 'talksofdeen.com',
      'asexualityandislam.com', 'islamisohbet.chat', 'islamsohbet.site', 'rakibislam.com', 'allahsoft.com',
    ]) {
      assert.ok(allow.has(`*.${h}`), h)
    }
    assert.match(read('data/allowlist.txt'), /\*\.allahsoft\.com +# Islamic-named, not verified adult; reviewed by hand before re-adding/)
  })

  test('the second audit\'s recovery, religious, health, medical, legal and random-sample false positives are allowlisted with everything under them', () => {
    const covered = (h: string): boolean => [...allow].some((a) => a.startsWith('*.') && (h === a.slice(2) || h.endsWith(a.slice(1))))
    for (const h of [
      'overcomeporn.co', 'overcomepornography.com', 'overcomingpornography.net', 'conqueringpornography.net', 'catholicmenconquerporn.com',
      'recoverfromporn.com', 'recoverfromporn.org', 'recoveringpornjunkie.tumblr.com', 'pornkills.org', 'seekingintegrity.com',
      'menssexualintegritycoaching.com', 'pornrehab.com', 'thepornrehab.com', 'porn-freedom13.tumblr.com', 'pornfreedom2.blogspot.com',
      'men-stopping-rape.org', 'stopitnow.nl', 'drugrehabcarsoncity.com', 'drugrehabforteensgeorgia-mj1.blogspot.com', 'drugrehabfortmorgan.com',
      'drugrehabgreenvalley.com', 'drugrehablosgatos.com', 'drugrehabrodeo.com', 'drugrehabsteamboatsprings.com', 'cokerehab.org',
      'tauhidweb.com', 'alfakirtauhid.blogspot.com', 'asunna.com', 'madrassa-elabqari.net', 'musulmanesonline.com', 'hanaumroh.com',
      'sagarhajj.com', 'hijrahsukses.com', 'moodlemajlis.com', 'jesus-is-lord.com', 'infantjesushighschool.com', 'prayerchaininternational.org',
      'allsaintsparish.org', 'virginiadiocese.org', 'diocesestp.com', 'adult-faith-formation.online', 'ezsermons.com', 'evangelio.com',
      'evangelicaloutreach.org', 'somosiglesia.net', 'chiesaromana.info', 'catholicnewsworld.com', 'jcsjacksonareacatholicschools.org',
      'firstbaptist.life', 'hartfordmethodist.org', 'jewishbookfestival.ca', 'izmirjewishheritage.com', 'hindufm.com', 'namo-buddha.org',
      'scarleteen.com', 'roo.plannedparenthood.org', 'healingsexualabuse.com', 'sexualabusehotline.com', 'sexualassaultevidencealliance.ca',
      'leedssexualhealth.com', 'hnesexualhealth.org.au', 'gpib.church', 'americanobgyn.com', 'lakelandobgyn.com', 'cosmeticgynecologydallas.com',
      'middlesexurology.com', 'urolognet.com', 'minnesotasexualharassmentattorney.com', 'sexualharassmentclaims.com',
      'batestickets.com', 'executivechoicesc.com', 'mywayresidenciaparaadultos.com.ar', 'oneprettything.com', 'olivatextil.ru', 'allslots.com',
      'gumusbakircilik.com', 'beautybyreeree.com', 'netbookbattery.ru', 'sd-cctv.com', 'hairmagicianunisexsalon.com', 'maryelschool.org', 'endepot.com',
    ]) {
      assert.ok(covered(h), h)
    }
    // Every host with "lutheran" in its name that any source lists.
    const lutheran = [...allow].filter((a) => a.includes('lutheran') && a.startsWith('*.'))
    assert.ok(lutheran.length >= 24, String(lutheran.length))
  })

  test('the ordinary sites found in the random samples of the final list are allowlisted', () => {
    const covered = (h: string): boolean => [...allow].some((a) => a.startsWith('*.') && (h === a.slice(2) || h.endsWith(a.slice(1))))
    for (const h of [
      'dikoross.ru', 'soulmate-finder.com', 'classicmovies.com', 'virgingaming.com', 'guancai365.com', 'minhatatuagem.com', 'cd-taxi.com',
      'popmatters.com', 'maranathamedia-myanmar.com', 'victorinoxknives.com', 'bytelearn.com', 'a1tel.co.uk',
    ]) {
      assert.ok(covered(h), h)
    }
  })

  test('pp.ru pages are allowlisted, and the ordinary blogspot blogs the audit found', () => {
    assert.ok(allow.has('*.pp.ru'))
    for (const h of ['bestamazonshoes.blogspot.com', 'puntoinfinito.blogspot.com', 'adventuresincyberia.blogspot.com', 'gamesvideossaga.blogspot.com', 'thecmthrone.blogspot.com', 'pharmacysearch-all.blogspot.com']) {
      assert.ok(allow.has(h), h)
    }
  })

  test('the false positives found by the top-10,000 subdomain review are allowlisted', () => {
    for (const h of ['beauty.about.com', 'blacklivesmatter.co.com', 'jokes.pp.ru', 'moviemeltdown.libsyn.com', 'emilymorse.libsyn.com', 'sexassault.meetup.com', 'blog-imgs-10.fc2.com']) {
      assert.ok(allow.has(h), h)
    }
  })

  test('single-source popular entries are allowlisted, not reviewed', () => {
    for (const h of ['*.mjedge.net', '*.chapturist.com', '*.oolveris.com', '*.lolpol3.com', 'sac.en.alibaba.com', 'everycom.en.alibaba.com', 'bestcotec.en.alibaba.com', 'wiseu.en.alibaba.com', 'jnruning.en.alibaba.com']) {
      assert.ok(allow.has(h), h)
      assert.ok(!reviewed.has(h.replace(/^\*\./, '')) && !subs.has(h), h)
    }
  })

  test('4chan\'s other domains are additions (founder decision)', () => {
    const additions = new Set(lines('data/additions.txt'))
    assert.ok(additions.has('4cdn.org') && additions.has('4channel.org'))
    assert.ok(reviewed.has('4chan.org'))
  })

  test('the starter list keeps to dedicated adult sites: mixed platforms excluded, the big sites added', () => {
    const exclude = new Set(lines('data/starter-exclude.txt'))
    for (const h of ['dlsite.com', 'donmai.us', 'janitorai.com', 'polybuzz.ai', 'beeg.porn']) assert.ok(exclude.has(h), h)
    const extra = new Set(lines('data/starter-extra.txt'))
    for (const h of ['txxx.com', 'beeg.com', 'bongacams.com', 'livejasmin.com', 'cam4.com', 'hqporner.com']) assert.ok(extra.has(h), h)
    // They stay in the full list.
    for (const h of ['dlsite.com', 'donmai.us', 'janitorai.com', 'polybuzz.ai']) assert.ok(reviewed.has(h), h)
  })
})
