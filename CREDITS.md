# Credits and licences

The Hayaa List is built from the public lists below. Each is pinned in
`sources.lock.json` to an exact commit and SHA-256. A source is used only
when its licence allows the list to be redistributed under the GNU General
Public License, version 3. The evidence for each licence was read from the
source itself; the commit or page it was read from is given.

The combined list (every file attached to a release) is distributed under
the GNU General Public License, **version 3 only** (`GPL-3.0-only`; see
`LICENSE`). The two GPL sources, HaGeZi and oisd, publish the version 3
text without an "or later" grant, so the combined list cannot offer later
versions. The code of this repository is separately licensed
`GPL-3.0-or-later` (see README.md).

## Copyright

The Hayaa List, Copyright (C) 2026 Hayaa LLC (https://hayaa.io): the code,
the hand-kept files in `data/` (its review files included), and the selection,
filtering and arrangement of the combined list. Each source below keeps its
own copyright.

## Additional terms (GPL-3.0 section 7)

For the material Hayaa LLC adds to this work (and so for the list as a
whole, which contains it), these terms are added to the GNU General Public
License, as its section 7 allows. They do not change the terms of the
sources' own material.

- **Attribution** (section 7(b)): every copy and every modified version
  must keep the notice "The Hayaa List, Copyright (C) 2026 Hayaa LLC
  (https://hayaa.io)" as a notice of origin, and the attributions in
  CREDITS.md. A modified version may give it as "Based on the Hayaa List,
  Copyright (C) 2026 Hayaa LLC (https://hayaa.io)".
- **Marking** (section 7(c)): a modified version must be marked as changed,
  including by a name other than "The Hayaa List", and must not be
  presented as the original.
- **Publicity** (section 7(d)): the names "Hayaa" and "Hayaa LLC" may not
  be used to say or suggest that Hayaa LLC publishes, endorses or supports
  a modified version.
- **Trademarks** (section 7(e)): no right is granted under trademark law to
  use the names "Hayaa" or "The Hayaa List", or Hayaa's logos.

**Modification notice** (GPL-3.0 section 5(a)): this list merges,
normalises and filters the sources below (public suffixes, protected names,
false keyword matches, the allowlist and the review gates are described in
README.md); each release's date is its serial (`YYYYMMDDNN`).

## Sources included

### ShadowWhisperer BlockLists: Adult

- File: `Lists/Adult` in https://github.com/ShadowWhisperer/BlockLists
- Licence: The Unlicense (public domain dedication)
- Evidence: `LICENSE` at commit `f9be3af266a54f8c380063078785fb9b9b270bd0`:
  "This is free and unencumbered software released into the public domain."
  The GitHub repository metadata also reports `Unlicense`.

### Sinfonietta hostfiles: pornography-hosts

- File: `pornography-hosts` in https://github.com/Sinfonietta/hostfiles
- Licence: MIT
- Evidence: `LICENSE` at commit `46f3097d7bcfc9eea323fe365074dfd771d0d17c`:
  "The MIT License (MIT) / Copyright (c) 2016 Sinfonietta". Full notice
  below.

### StevenBlack hosts: porn extension, Clefspeare13 pornhosts

- File: `extensions/porn/clefspeare13/hosts` in https://github.com/StevenBlack/hosts
- Licence: MIT
- Evidence, at commit `11550239d5714d60b62be8796446ecba84a1bfb2`:
  - `extensions/porn/clefspeare13/update.json`: `"license": "MIT"` (the
    monthly job checks this field at every new commit).
  - The file's own header: "License: MIT
    (https://github.com/Clefspeare13/pornhosts/blob/master/LICENSE)".
  - The repository's `license.txt`: "The MIT License (MIT) / Copyright ©
    2026 Steven Black". Full notice below.
  - The original repository, Clefspeare13/pornhosts, has been unavailable on
    GitHub since 2021 (access blocked by GitHub), so its own `LICENSE` file
    could not be read; the list is now maintained inside StevenBlack/hosts.

### StevenBlack hosts: porn extension, BigDargon hostsVN adult

- File: `extensions/porn/bigdargon/hosts` in https://github.com/StevenBlack/hosts
  (a copy of `extensions/adult/hosts-VN` from https://github.com/bigdargon/hostsVN)
- Licence: MIT
- Evidence:
  - `extensions/porn/bigdargon/update.json` at commit
    `11550239d5714d60b62be8796446ecba84a1bfb2`: `"license": "MIT"`.
  - `LICENSE` of bigdargon/hostsVN at commit
    `ccda2647ec884fad18ffcb3623989ebc4afa8561` (2026-01-07): "MIT License /
    Copyright (c) 2026 BigDargon". Full notice below. The repository
    metadata also reports `MIT`.

### HaGeZi DNS Blocklists: NSFW

- File: `wildcard/nsfw-onlydomains.txt` in https://github.com/hagezi/dns-blocklists
- Licence: GNU General Public License v3.0
- Evidence, at commit `fe713e1806d89e87582ad905eaa3fa6bed621b84`:
  - `LICENSE`: "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007"
    (byte-identical to https://www.gnu.org/licenses/gpl-3.0.txt, SHA-256
    `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`).
  - The file's header: "License:
    https://github.com/hagezi/dns-blocklists/blob/main/LICENSE".

### oisd nsfw

- File: `domainswild2_nsfw.txt` in https://github.com/sjhgvr/oisd
  (maintainer Stephan van Ruth, https://oisd.nl)
- Licence: GNU General Public License v3.0
- Evidence:
  - `LICENSE` at commit `31fd2dd680316021237eb5423caf93400541cdf4`: the GPL
    version 3 text, byte-identical to gnu.org's (same SHA-256 as above).
  - The file's header: "License: https://github.com/sjhgvr/oisd/blob/main/LICENSE".
  - https://oisd.nl/faq#license: "Under which license are the oisd lists
    distributed? GNU General Public License v3.0".

### The Block List Project: porn (frozen)

- File: `porn.txt` in https://github.com/blocklistproject/Lists
- Pinned for good to commit `4f5fb53d6c5c2ed75d5378cdee12f640b0f6f2c7`
  (2026-07-18, the last change to `porn.txt`), SHA-256
  `425590c37e3ea624fdf646b14ba661f8b8f38391686adcf02b73f8b2d74b0db1`. This is
  byte for byte the file the Hayaa app's earlier bundled blocklist was built
  from (its build metadata records the same SHA-256), and it is still the
  file on the default branch. The repository is archived, so the source is
  marked `frozen` in `sources.lock.json` and the monthly job never re-pins it.
- Licence: The Unlicense (public domain dedication)
- Evidence:
  - `LICENSE` at commit `4f5fb53d6c5c2ed75d5378cdee12f640b0f6f2c7`: "This is
    free and unencumbered software released into the public domain." (SHA-256
    `6b0382b16279f26ff69014300541967a356a666eb0b91b422f6862f6b7dad17e`, the
    same text as ShadowWhisperer's).
  - The GitHub repository metadata reports `Unlicense` and `archived: true`.
  - The file's own header says "License: MIT". Both licences allow the list
    to be redistributed under the GPL; the repository's `LICENSE` is the
    one recorded.

## Sources considered and not included

| Source | Reason |
|---|---|
| StevenBlack porn extension: tiuxo | Licence CC BY 4.0 (`update.json`); only the MIT parts are used |
| StevenBlack porn extension: brijrajparmar27 | Licence CC BY 4.0 (`update.json`); only the MIT parts are used |
| StevenBlack porn extension: sinfonietta | MIT, but a copy of Sinfonietta's list, which is used directly |
| StevenBlack porn extension: sinfonietta-snuff | MIT, but a list of violent (snuff) sites, outside this list's scope |

## Build-time references (not redistributed)

These are used while building, to check the list. They are not part of the
list and are not published with it.

### Public Suffix List

- https://publicsuffix.org, file `public_suffix_list.dat` in
  https://github.com/publicsuffix/list, pinned by commit in
  `sources.lock.json`.
- Licence: Mozilla Public License 2.0.
- Use: the build refuses any entry that is a bare public suffix (such as
  `co.uk` or `blogspot.com`), and finds the registrable domain of entries.

### Tranco top sites ranking

- https://tranco-list.eu, pinned by permanent list ID in `src/config.ts`
  (`TRANCO_LIST_ID`, copied into `sources.lock.json` with its SHA-256; at
  the time of writing `PY2VJ`, a custom list created 2026-11-09 from the 30
  days 2026-10-10 to 2026-11-08; providers CrUX, Majestic and Cisco
  Umbrella, combined by the Dowdall rule; registrable domains only). The top
  10,000 entries are used.
- Terms: the Tranco site publishes no licence of its own for the list. Its
  attribution section states the terms of its inputs. The three used here:
  Cisco Umbrella (available free of charge), Majestic (CC BY 3.0) and the
  Chrome User Experience Report (CC BY-SA 4.0). Tranco says it is not
  affiliated with any of them. Cloudflare Radar (CC BY-NC 4.0, no commercial
  use) is left out on purpose, and Farsight because custom lists do not offer
  it. Tranco asks users to cite
  its paper: Victor Le Pochat, Tom Van Goethem, Samaneh Tajalizadehkhoob,
  Maciej Korczyński and Wouter Joosen, "Tranco: A Research-Oriented Top
  Sites Ranking Hardened Against Manipulation", NDSS 2019.
- Use: the review gates (every top-10,000 site the list would block, and
  every listed subdomain of a top-10,000 site, must be reviewed by hand) and
  the choice of the starter list. The ranking is never redistributed: no
  ranks are stored in this repository or in a release.
- A new list is a new custom Tranco list without Cloudflare Radar; its ID
  replaces the one in `src/config.ts` (one line), and the next run re-pins
  it. Moving to another list surfaces new popular entries for review.

## MIT licence notices

The following notices apply to the entries that come from the MIT-licensed
sources above. The Clefspeare13 list's own copyright line could not be read
(its repository is unavailable), so its contributors are named generically.
The Block List Project's repository licence is the Unlicense, but its file
header says MIT; its line is included as a precaution. The licence text is
the same for each:

```
Copyright (c) 2016 Sinfonietta
Copyright © 2026 Steven Black
Copyright (c) Clefspeare13 pornhosts contributors
Copyright (c) 2026 BigDargon
Copyright (c) The Block List Project contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Build tools

- pako (MIT and Zlib), punycode.js (MIT): runtime dependencies of the build script.
- tsx (MIT), TypeScript (Apache-2.0): development dependencies.
