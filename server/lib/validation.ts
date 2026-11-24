import { isIP } from 'node:net';
import type { ZodType } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validate<T>(schema: ZodType<T>, request: Request, response: Response, next: NextFunction): void {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: result.error.issues.map((issue) => issue.message).join('; ') });
    return;
  }
  request.body = result.data;
  next();
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export async function assertSafeUrl(raw: string, allowPrivate = process.env.RELAY_ALLOW_PRIVATE_NETWORK === 'true'): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Only HTTP and HTTPS endpoints are supported.');
  if (url.username || url.password) throw new HttpError(400, 'Credentials belong in secret headers, not the URL.');
  if (allowPrivate) return url;
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new HttpError(400, 'Private-network targets are blocked by default. See RELAY_ALLOW_PRIVATE_NETWORK in the README.');
  const { lookup } = await import('node:dns/promises');
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new HttpError(400, 'The endpoint hostname could not be resolved.'); }
  if (!addresses.length || addresses.some(({ address }) => isIP(address) === 0 || isPrivateIp(address))) {
    throw new HttpError(400, 'Private or reserved network targets are blocked by default.');
  }
  return url;
}

export function redactSecrets(value: string, secrets: string[]): string {
  return secrets.reduce((result, secret) => secret.length >= 4 ? result.replaceAll(secret, '[REDACTED]') : result, value);
}
