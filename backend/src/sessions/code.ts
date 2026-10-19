import { randomInt } from 'node:crypto';
import { LIMITS } from '@retrolive/shared';

// No 0/O or 1/I/L, so a code read aloud or typed from a screen cannot be mistaken.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode(length: number = LIMITS.JOIN_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
