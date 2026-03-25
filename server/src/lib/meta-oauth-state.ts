/**
 * Signed OAuth state for Meta — shared by /api/meta/connect and /api/auth/meta/callback
 */

import crypto from 'crypto';

export interface MetaOAuthStatePayload {
  agencyId: string;
  clientId: string;
  userId?: string;
  ts?: number;
}

function getStateSecret(): string {
  return process.env.META_STATE_SECRET || process.env.META_APP_SECRET || 'fallback-secret-change-me';
}

/** Max age for state (Facebook dialog can stay open a while). */
const STATE_MAX_AGE_MS = 30 * 60 * 1000;

export function signState(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', getStateSecret()).update(data).digest('base64url');
  return `${data}.${hmac}`;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Verify signed state from query string. Express already URL-decodes req.query values.
 */
export function verifySignedState(state: string): MetaOAuthStatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', getStateSecret()).update(data).digest('base64url');
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as MetaOAuthStatePayload;
    if (typeof parsed.ts === 'number' && Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Legacy: unsigned base64(JSON) state (no dot, standard base64 alphabet).
 */
export function parseLegacyState(state: string): MetaOAuthStatePayload | null {
  try {
    const json = Buffer.from(state, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as MetaOAuthStatePayload;
    if (!parsed?.clientId || !parsed?.agencyId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseMetaOAuthState(state: string): MetaOAuthStatePayload | null {
  if (state.includes('.')) {
    return verifySignedState(state);
  }
  return parseLegacyState(state);
}
