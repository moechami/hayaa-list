// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from 'node:crypto'

/** Lowercase hex SHA-256 of bytes or a UTF-8 string. */
export const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')
