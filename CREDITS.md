# Credits and licences

The Hayaa List is built from the public lists below. Each is pinned in
`sources.lock.json` to an exact commit and SHA-256. A source is used only
when its licence allows the list to be redistributed under the GNU General
Public License, version 3. The evidence for each licence was read from the
source itself; the commit or page it was read from is given.

The combined list is distributed under the GNU General Public License,
version 3 or (at your option) any later version (see `LICENSE`). The two
GPL sources publish the GPL version 3 text without naming a version
restriction.

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
  - `extensions/porn/clefspeare13/update.json`: `"license": "MIT"`.
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
  - `LICENSE` of bigdargon/hostsVN: "MIT License / Copyright (c) 2026
    BigDargon". Full notice below.

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

## Sources considered and not included

| Source | Reason |
|---|---|
| StevenBlack porn extension: tiuxo | Licence CC BY 4.0 (`update.json`); only the MIT parts are used |
| StevenBlack porn extension: brijrajparmar27 | Licence CC BY 4.0 (`update.json`); only the MIT parts are used |
| StevenBlack porn extension: sinfonietta | MIT, but a copy of Sinfonietta's list, which is used directly |
| StevenBlack porn extension: sinfonietta-snuff | MIT, but a list of violent (snuff) sites, outside this list's scope |
| The Block List Project: porn | Repository archived; its content is largely contained in HaGeZi and oisd |

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

- https://tranco-list.eu, pinned by permanent list ID in `sources.lock.json`
  (at the time of writing `PYK6J`, created 2026-10-29 from the 30 days
  2026-09-30 to 2026-10-29; providers CrUX, Farsight, Majestic, Cloudflare
  Radar and Cisco Umbrella; registrable domains only). The top 10,000
  entries are used.
- Terms: the Tranco site publishes no licence of its own for the list. Its
  attribution section states the terms of its inputs: Cisco Umbrella
  (available free of charge), Majestic (CC BY 3.0), Farsight, the Chrome User
  Experience Report (CC BY-SA 4.0) and Cloudflare Radar (CC BY-NC 4.0), and
  says Tranco is not affiliated with any of them. Tranco asks users to cite
  its paper: Victor Le Pochat, Tom Van Goethem, Samaneh Tajalizadehkhoob,
  Maciej Korczyński and Wouter Joosen, "Tranco: A Research-Oriented Top
  Sites Ranking Hardened Against Manipulation", NDSS 2019.
- Use: a review gate (every popular site the list would block must be
  reviewed by hand) and the choice of the starter list. The ranking is never
  redistributed: no ranks are stored in this repository or in a release.

## MIT licence notices

The following notices apply to the entries that come from the MIT-licensed
sources above. The licence text is the same for each:

```
Copyright (c) 2016 Sinfonietta
Copyright © 2026 Steven Black
Copyright (c) 2026 BigDargon

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
