/**
 * Simple in-memory rate limiter
 * 
 * MVP: In-memory store (clears on server restart)
 * Production: Use Redis or similar persistent store
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Check if a request should be rate limited
 * @param key - Unique identifier (e.g., IP address, email)
 * @param maxRequests - Maximum requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns true if rate limited, false otherwise
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // Create new entry or reset expired entry
    store.set(key, {
      count: 1,
      resetAt: now + windowMs
    });
    return false;
  }

  if (entry.count >= maxRequests) {
    return true; // Rate limited
  }

  entry.count++;
  return false;
}

/**
 * Clear rate limit for a key (useful for testing)
 */
export function clearRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Clear all rate limits (useful for testing)
 */
export function clearAllRateLimits(): void {
  store.clear();
}

/**
 * Clean up expired entries (call periodically)
 */
export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}

// Clean up expired entries every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
