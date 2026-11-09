// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.
//
// The punycode package (imported as 'punycode/' so Node's deprecated
// built-in module of the same name is never picked up).
declare module 'punycode/' {
  const punycode: { toASCII(input: string): string; toUnicode(input: string): string }
  export default punycode
}
