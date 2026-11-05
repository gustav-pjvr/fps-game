import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The shared access code check (docs/server-relay-design.md, section 5.3). Only SHA-256 digests of
 * the configured codes are kept, and every check compares the candidate's digest against every one
 * of them with crypto.timingSafeEqual, without stopping at a match, so neither the timing nor the
 * object itself reveals a code. Nothing here logs, stores or returns a code.
 */

const digestOf = (code: string): Buffer => createHash('sha256').update(code, 'utf8').digest();

/** Split HNG_ACCESS_CODES (comma separated) into codes, trimmed, empty entries dropped. */
export function parseAccessCodes(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw.split(',').map((code) => code.trim()).filter((code) => code.length > 0);
}

export class AccessCodes {
  readonly #digests: readonly Buffer[];

  /** Throws when no code is configured: a relay with no code would let anyone in. */
  constructor(codes: readonly string[]) {
    if (codes.length === 0 || codes.some((code) => code.length === 0)) throw new Error('At least one non-empty access code is required');
    this.#digests = codes.map(digestOf);
  }

  get count(): number {
    return this.#digests.length;
  }

  /** Whether `candidate` is one of the codes. Anything not a non-empty string is refused, after the
   * same comparisons a real attempt costs. */
  check(candidate: unknown): boolean {
    const valid = typeof candidate === 'string' && candidate.length > 0;
    const digest = digestOf(valid ? candidate : '');
    let match = false;
    for (const expected of this.#digests) {
      // Every digest is compared; `||` would skip the rest after a match.
      match = timingSafeEqual(expected, digest) || match;
    }
    return valid && match;
  }

  toJSON(): string {
    return '[AccessCodes]';
  }

  toString(): string {
    return '[AccessCodes]';
  }
}
