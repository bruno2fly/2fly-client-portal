/**
 * Token encryption utilities
 * Uses AES-256-GCM for encrypting Google refresh tokens
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Get encryption key from environment variable
 * In production, ensure GOOGLE_TOKEN_SECRET is set (32+ bytes recommended)
 */
function getEncryptionKey(): Promise<Buffer> {
  const secret = process.env.GOOGLE_TOKEN_SECRET || 'default-secret-key-change-in-production-32bytes!!';
  if (secret.length < 32) {
    console.warn('GOOGLE_TOKEN_SECRET should be at least 32 characters for security');
  }
  return scryptAsync(secret, 'salt', KEY_LENGTH) as Promise<Buffer>;
}

/**
 * Encrypt a refresh token
 */
export async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(token, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const tag = cipher.getAuthTag();
  
  // Combine IV + tag + encrypted data
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a refresh token
 */
export async function decryptToken(encryptedToken: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Buffer.from(encryptedToken, 'base64');
  
  // Extract IV, tag, and encrypted data
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}

