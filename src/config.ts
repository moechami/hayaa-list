// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// Every tunable of the build in one place. Each value is a deliberate choice;
// the comment says why it has the value it has.

/**
 * The Tranco list the build uses, by permanent list ID (https://tranco-list.eu).
 * Switching lists is this one line: `npm run update-lock` (and the monthly
 * job, which runs it) re-pins sources.lock.json to the ID given here, and the
 * build refuses a lock that names another ID.
 *
 * PY2VJ: a custom list created 2026-11-09 from the 30 days 2026-10-10 to
 * 2026-11-08, providers CrUX, Majestic and Cisco Umbrella, Dowdall,
 * pay-level domains only. It leaves out Cloudflare Radar (CC BY-NC 4.0) and
 * Farsight (not offered for custom lists); see CREDITS.md.
 */
export const TRANCO_LIST_ID = 'PY2VJ'

/** How many Tranco ranks the top-sites review gate covers. */
export const TRANCO_TOP = 10_000

/**
 * Listed subdomains of the most popular registrable domains (this many Tranco
 * ranks) must be reviewed too: one wrong entry there (m.vk.com) breaks a site
 * millions of people use, while the site itself passes the top-sites gate.
 * The whole pinned top 10,000.
 */
export const TOP_SUBDOMAIN_RANKS = 10_000

/** Size of the free starter list, and how many of its entries one brand may take. */
export const STARTER_SIZE = 50
export const STARTER_PER_BRAND = 2

/**
 * A monthly build holds back new, unreviewed popular entries and still
 * releases. More than this many new ones in one month is not the normal
 * trickle of a growing list; it suggests a broken or poisoned upstream, so
 * the build fails and nothing is published.
 */
export const MAX_NEW_HELD_BACK = 25

/**
 * Shrink gates against the previous release. A list that loses more than 10%
 * of its hosts, or a source that loses more than 30% of its own, in one month
 * has almost certainly been truncated or changed format upstream. Real
 * month-to-month changes are a few percent.
 */
export const MIN_TOTAL_RATIO = 0.9
export const MIN_SOURCE_RATIO = 0.7

/**
 * Slow-shrink guard. The 10% gate above compares with the previous release
 * only, so a list could lose 9% a month for months. The total is therefore
 * also compared with the largest of the last SHRINK_HISTORY releases (their
 * counts travel in the signed build-info.json), and must never fall below
 * MIN_HOST_FLOOR, about 80% of the first release (1.1 million hosts). After a
 * deliberate, reviewed removal (allow_shrink), the history restarts from that
 * release; the floor is lowered only by editing this line.
 */
export const SHRINK_HISTORY = 6
export const MIN_HOST_FLOOR = 900_000

/**
 * Growth gates against the previous release. A hijacked or broken upstream
 * shows as sudden growth as surely as shrinkage: a list that grows more than
 * 15% in one month, a source that grows more than 30%, or a source that adds
 * more than 50,000 registrable domains the previous release did not list,
 * stops the build. Real months add a few percent. A maintainer who has
 * checked the growth can pass the workflow input allow_growth (shown in the
 * release notes).
 */
export const MAX_TOTAL_GROWTH = 0.15
export const MAX_SOURCE_GROWTH = 0.3
export const MAX_NEW_REGISTRABLE_DOMAINS = 50_000

/**
 * Sources built partly by matching words inside domain names. Hosts that only
 * these sources list go through data/keyword-false-matches.txt, which removes
 * names such as "essexroofing.co.uk" that matched "sex" inside "Essex".
 */
export const KEYWORD_MATCHED_SOURCES: readonly string[] = ['blocklistproject-porn']

/**
 * BLP_STRICT (prepared, OFF). The Block List Project matched words inside
 * names, so many hosts only it lists have ordinary names. When true, a host
 * that ONLY a keyword-matched source lists is kept only if its name has a
 * strong explicit term ("strong" lines in data/keyword-false-matches.txt:
 * porn, xxx, sex outside an ordinary word, hentai, nude, nsfw, milf, fuck,
 * pussy, dick, cock, tits, boob, escort, erotic, camgirl, xvideo, xhamster,
 * onlyfans, jav, webcam or adult together with sex, porn or video); every
 * other such host is held back (counted in build-info.json, listed in
 * dist/held-back-blp-strict.txt). Hosts a person reviewed as adult stay.
 * Switching it on removes a large share of the list at once: the release
 * that does so needs allow_shrink, and MIN_HOST_FLOOR must be lowered
 * first (see the README for the measured effect).
 */
export const BLP_STRICT = false

/**
 * A source whose unreadable lines exceed 1% of its non-comment lines (and at
 * least MIN_SKIPPED_LINES of them) has changed format: every current source
 * stays under 0.03% (a handful of malformed or over-long lines), while a
 * switch to another syntax, such as adblock rules, makes nearly every line
 * unreadable. The floor keeps a tiny source with a few bad lines from failing.
 */
export const MAX_SKIPPED_RATIO = 0.01
export const MIN_SKIPPED_LINES = 100

/**
 * Education and government suffixes (src/edugov.ts). A listed host under one
 * is held back until reviewed into data/reviewed-edu-gov.txt. The labels
 * mark an ICANN suffix when they are not its top-level domain ("ac.uk",
 * "sch.id", "k12.tr", "gob.mx", "gouv.fr", "go.jp", "gc.ca", "govt.nz",
 * "gv.at", "ed.jp", "school.nz", "nhs.uk", "police.uk", "parliament.nz",
 * "gub.uy", "gop.pk", "mod.gi"); edu, gov and mil also count as top-level
 * domains. "go.it" is the Italian province of Gorizia, not a government
 * suffix; "nic.in" is India's government network.
 */
export const EDU_GOV_LABELS: readonly string[] = [
  'edu', 'gov', 'mil', 'ac', 'sch', 'k12', 'gob', 'gouv', 'go', 'gc', 'govt', 'gv', 'ed', 'school', 'nhs', 'police', 'parliament', 'gub', 'gop', 'mod',
]
export const EDU_GOV_TLDS: readonly string[] = ['edu', 'gov', 'mil']
export const EDU_GOV_EXTRA_SUFFIXES: readonly string[] = ['nic.in']
export const EDU_GOV_EXCLUDED_SUFFIXES: readonly string[] = ['go.it']

/** Signing key id written into the manifest when HAYAA_LIST_KEY_ID is not set. */
export const DEFAULT_KEY_ID = 'k1'
