import { createHash, timingSafeEqual } from 'node:crypto';

export function validAdminKey(candidate: unknown, key: string): boolean {
  if (typeof candidate !== 'string' || key.length < 32) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(candidate), hash(key));
}
