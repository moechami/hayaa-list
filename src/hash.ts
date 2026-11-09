// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Hayaa LLC. Additional terms under GPL-3.0 section 7: see README.md.

import { createHash } from 'node:crypto'

/** Lowercase hex SHA-256 of bytes or a UTF-8 string. */
export const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')
