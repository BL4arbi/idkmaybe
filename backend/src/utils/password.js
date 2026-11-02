import crypto from 'node:crypto';
import { promisify } from 'node:util';

// scrypt from Node itself: it runs on libuv's thread pool, so several logins
// at the same moment are hashed in parallel instead of queueing on the single
// JavaScript thread (15 simultaneous logins: ~1 s with bcryptjs).
const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

// Stored as "scrypt$<salt>$<hash>", both base64.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, PARAMS);
  return crypto.timingSafeEqual(actual, expected);
}
