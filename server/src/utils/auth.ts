/**
 * Authentication utilities
 * Password hashing, token generation, validation
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';

const BCRYPT_ROUNDS = 12; // Cost factor for bcrypt

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a secure random token (32 bytes, base64url encoded)
 * Returns both the plain token and its SHA-256 hash
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/**
 * Hash a token using SHA-256
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a unique ID
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 9);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Generate username from email (e.g., john@example.com -> john)
 */
export function generateUsernameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  // Remove special characters, keep only alphanumeric
  return localPart.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Generate a random password (12 characters, alphanumeric + special)
 */
export function generateRandomPassword(length: number = 12): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  const all = uppercase + lowercase + numbers + special;
  
  let password = '';
  // Ensure at least one of each type
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}
