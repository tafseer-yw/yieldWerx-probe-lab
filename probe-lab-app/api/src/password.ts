/*
 * scrypt password hashing — faithful port of packages/domain/src/password.ts.
 * Format: scrypt-v1$<salt-hex>$<hash-hex>
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const FORMAT = 'scrypt-v1';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${FORMAT}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [format, saltHex, hashHex, extra] = encodedHash.split('$');
  if (format !== FORMAT || !saltHex || !hashHex || extra !== undefined) return false;

  try {
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== KEY_LENGTH) return false;
    const actual = (await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH)) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
