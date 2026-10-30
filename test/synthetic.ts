// A small, fully local build input for the pipeline tests: no network.

import type { BuildInput } from '../src/pipeline'

/** A Public Suffix List with the rules the tests need, padded past the truncation guard. */
export const SYNTHETIC_PSL = [
  '// ===BEGIN ICANN DOMAINS===',
  'com',
  'net',
  'org',
  'uk',
  'co.uk',
  '*.ck',
  '!www.ck',
  '// ===BEGIN PRIVATE DOMAINS===',
  'blogspot.com',
  ...Array.from({ length: 1000 }, (_, i) => `filler${i}`),
].join('\n')

export const baseInput = (): BuildInput => ({
  sources: [
    {
      id: 'hosts-format',
      text: [
        '# comment',
        '0.0.0.0 adult-one.com',
        '0.0.0.0 www.adult-two.com',
        '0.0.0.0 cdn.adult-one.com', // covered by adult-one.com
        '0.0.0.0 blogspot.com', // a public suffix: dropped
        '0.0.0.0 someone.blogspot.com', // kept: a site on the platform
        '0.0.0.0 co.uk', // a public suffix: dropped
        '0.0.0.0 platform.com', // allowlisted (root only)
        '127.0.0.1 localhost',
      ].join('\n'),
    },
    {
      id: 'plain-format',
      text: ['adult-three.net', 'sub.platform.com', 'ads.safe.org', 'adult-cdn.com', 'not a host!'].join('\n'),
    },
  ],
  data: {
    allowlist: 'platform.com  # root only\n*.safe.org  # with subdomains\n',
    additions: '# none\n',
    paths: 'reddit.com/r/adult  # page entry\n',
    reviewedTopHits: 'adult-one.com\nadult-two.com\nadult-cdn.com\n',
    starterExtra: 'adult-three.net\n',
    starterExclude: 'adult-cdn.com\n',
    canaries: 'adult-one.com\nreddit.com /r/adult/x\n',
    negatives: 'google.com\nplatform.com\nreddit.com /r/other\n',
  },
  psl: SYNTHETIC_PSL,
  tranco: ['1,google.com', '2,adult-cdn.com', '3,adult-two.com', '4,platform.com', '5,adult-one.com', '6,unranked-gate.com'].join('\r\n'),
  trancoTop: 5,
  serial: 2026110101,
  keyId: 'k1',
  starterSize: 2,
})
