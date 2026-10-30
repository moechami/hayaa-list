// Every tunable of the build in one place. Each value is a deliberate choice;
// the comment says why it has the value it has.

/**
 * The Tranco list the build uses, by permanent list ID (https://tranco-list.eu).
 * Switching lists is this one line: `npm run update-lock` (and the monthly
 * job, which runs it) re-pins sources.lock.json to the ID given here, and the
 * build refuses a lock that names another ID.
 *
 * PYK6J: created 2026-10-29 from the 30 days 2026-09-30 to 2026-10-29,
 * default providers. TODO: replace with a custom list that leaves out
 * Cloudflare Radar (CC BY-NC 4.0) once it is created; see CREDITS.md.
 */
export const TRANCO_LIST_ID = 'PYK6J'

/** How many Tranco ranks the top-sites review gate covers. */
export const TRANCO_TOP = 10_000

/**
 * Listed subdomains of the most popular registrable domains (this many Tranco
 * ranks) must be reviewed too: one wrong entry there (m.vk.com) breaks a site
 * millions of people use, while the site itself passes the top-sites gate.
 */
export const TOP_SUBDOMAIN_RANKS = 1_000

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
 * A source whose unreadable lines exceed 1% of its non-comment lines (and at
 * least MIN_SKIPPED_LINES of them) has changed format: every current source
 * stays under 0.03% (a handful of malformed or over-long lines), while a
 * switch to another syntax, such as adblock rules, makes nearly every line
 * unreadable. The floor keeps a tiny source with a few bad lines from failing.
 */
export const MAX_SKIPPED_RATIO = 0.01
export const MIN_SKIPPED_LINES = 100

/** Signing key id written into the manifest when HAYAA_LIST_KEY_ID is not set. */
export const DEFAULT_KEY_ID = 'k1'
