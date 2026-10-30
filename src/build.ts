/* The Hayaa List build.
 *
 *   npm run build                           # serial = today (UTC) and run 01
 *   npm run build -- --out dist-check       # another output folder
 *   npm run build -- --previous previous    # compare against this previous release
 *   npm run build -- --previous none        # compare against nothing
 *
 * The previous release (see src/previous.ts) defaults to the earlier build
 * in dist/, read before dist/ is replaced; with none, every unreviewed
 * popular entry counts as new and is held back, and the shrink gates are
 * skipped. In CI it is the latest GitHub release.
 *
 * Environment:
 *   HAYAA_LIST_RUN           run number NN of the day, 1..99 (default 1)
 *   HAYAA_LIST_DATE          build date YYYYMMDD (default: today, UTC)
 *   HAYAA_LIST_SERIAL        full serial YYYYMMDDNN; overrides the two above
 *   HAYAA_LIST_KEY_ID        key id written into the manifest (default k1)
 *   HAYAA_LIST_ALLOW_SHRINK  "1" skips the shrink gates (a reviewed removal of a source)
 *
 * Fetches the inputs pinned in sources.lock.json (cached in .cache/ by
 * hash), runs every gate in src/pipeline.ts and writes the output folder.
 * Exit code 1 on any failed gate, with nothing but the failure report
 * written.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_KEY_ID, MAX_NEW_HELD_BACK, STARTER_PER_BRAND, STARTER_SIZE, TOP_SUBDOMAIN_RANKS, TRANCO_LIST_ID } from './config'
import { fetchPinned, readLock } from './lock'
import { GateError, runBuild, serialFor } from './pipeline'
import { readPreviousDir, type PreviousRelease } from './previous'

const ROOT = resolve(__dirname, '..')
const CACHE = join(ROOT, '.cache', 'inputs')

const readData = (name: string): string => readFileSync(join(ROOT, 'data', name), 'utf8')

const parseArgs = (argv: string[]): { out: string; previous: string | null } => {
  let out = join(ROOT, 'dist')
  let previous: string | null = join(ROOT, 'dist')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = resolve(argv[++i] ?? '')
    else if (argv[i] === '--previous') {
      const v = argv[++i] ?? ''
      previous = v === 'none' ? null : resolve(v)
    } else throw new Error(`unknown argument ${argv[i]}`)
  }
  return { out, previous }
}

const resolveSerial = (): number => {
  const env = process.env
  if (env.HAYAA_LIST_SERIAL) {
    const s = Number(env.HAYAA_LIST_SERIAL)
    if (!/^[0-9]{10}$/.test(env.HAYAA_LIST_SERIAL) || s > 0xffffffff) throw new Error('HAYAA_LIST_SERIAL must be YYYYMMDDNN')
    return s
  }
  let date = new Date()
  if (env.HAYAA_LIST_DATE) {
    const m = /^([0-9]{4})([0-9]{2})([0-9]{2})$/.exec(env.HAYAA_LIST_DATE)
    if (!m) throw new Error('HAYAA_LIST_DATE must be YYYYMMDD')
    date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  }
  return serialFor(date, Number(env.HAYAA_LIST_RUN ?? '1'))
}

const main = async (): Promise<void> => {
  const { out, previous: previousDir } = parseArgs(process.argv.slice(2))
  const serial = resolveSerial()
  const keyId = process.env.HAYAA_LIST_KEY_ID ?? DEFAULT_KEY_ID
  const lock = readLock(join(ROOT, 'sources.lock.json'))
  if (lock.tranco.listId !== TRANCO_LIST_ID) {
    throw new Error(`sources.lock.json pins Tranco list ${lock.tranco.listId} but src/config.ts names ${TRANCO_LIST_ID}; run npm run update-lock`)
  }
  const decode = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b)

  const sources = []
  for (const s of lock.sources) sources.push({ id: s.id, commit: s.commit, text: decode(await fetchPinned(s.url, s.sha256, CACHE)) })
  const psl = decode(await fetchPinned(lock.publicSuffixList.url, lock.publicSuffixList.sha256, CACHE))
  const tranco = decode(await fetchPinned(lock.tranco.url, lock.tranco.sha256, CACHE))

  // Read the previous release before the output folder (often the same one) is replaced.
  const previous: PreviousRelease | null = previousDir === null ? null : readPreviousDir(previousDir)
  console.log(`previous release: ${previous ? previous.origin : 'none'}`)

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  let result
  try {
    result = runBuild({
      sources,
      data: {
        allowlist: readData('allowlist.txt'),
        additions: readData('additions.txt'),
        paths: readData('paths.txt'),
        reviewedTopHits: readData('reviewed-top-hits.txt'),
        reviewedTopSiteSubdomains: readData('reviewed-top-site-subdomains.txt'),
        starterExtra: readData('starter-extra.txt'),
        starterExclude: readData('starter-exclude.txt'),
        starterBrands: readData('starter-brands.txt'),
        canaries: readData('canaries.txt'),
        negatives: readData('negatives.txt'),
      },
      psl,
      tranco,
      trancoTop: lock.tranco.top,
      subdomainRanks: TOP_SUBDOMAIN_RANKS,
      serial,
      keyId,
      starterSize: STARTER_SIZE,
      starterPerBrand: STARTER_PER_BRAND,
      previous,
      maxNewHeldBack: MAX_NEW_HELD_BACK,
      allowShrink: process.env.HAYAA_LIST_ALLOW_SHRINK === '1',
    })
  } catch (e) {
    if (e instanceof GateError) {
      if (e.details.file && e.details.lines) {
        writeFileSync(join(out, e.details.file), e.details.lines.join('\n') + '\n')
      }
      console.error(`GATE FAILED: ${e.message}`)
      process.exitCode = 1
      return
    }
    throw e
  }

  for (const [name, bytes] of result.files) writeFileSync(join(out, name), bytes)
  writeFileSync(join(out, 'build-report.json'), JSON.stringify(result.report, null, 2) + '\n')
  // Review aids only: never attached to a release.
  const lines = (xs: readonly string[]): string => (xs.length ? xs.join('\n') + '\n' : '')
  writeFileSync(join(out, 'review-top-site-subdomains.txt'), lines(result.topSiteSubdomainEntries))
  writeFileSync(
    join(out, 'held-back.txt'),
    lines([...result.heldBack.topSites.map((h) => `top site: ${h}`), ...result.heldBack.topSiteSubdomains.map((h) => `subdomain of a top site: ${h}`)]),
  )
  writeFileSync(join(out, 'kept-unreviewed.txt'), lines(result.keptFromPrevious))

  console.log(JSON.stringify(result.report, null, 2))
  console.log(`\nstarter list (${result.starter.length}), most popular first:`)
  for (const h of result.starter) console.log(`  ${h}`)
  for (const w of result.report.warnings) console.warn(`warning: ${w}`)
  console.log(`\nwrote ${out} (serial ${serial})`)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
