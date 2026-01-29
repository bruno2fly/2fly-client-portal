/**
 * Authentication routes
 * POST /api/auth/login
 * POST /api/auth/logout
 * POST /api/auth/forgot-password
 * POST /api/auth/reset-password
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { getUserByEmail, getUserByUsername, getUser, saveUser, getPasswordResetTokenByHash, markPasswordResetTokenUsed, savePasswordResetToken, saveAuditLog, getClient, getClientCredentials } from '../db.js';
import { verifyPassword, hashPassword, generateToken, hashToken, generateId } from '../utils/auth.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { checkRateLimit } from '../utils/rateLimit.js';
import type { User } from '../types.js';

const router = express.Router();
router.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-use-strong-secret';
const JWT_EXPIRES_IN = '7d'; // 7 days
const COOKIE_NAME = '2fly_session';

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, username, password, agencyId } = req.body;

    // Dev-only: log received keys (never log password)
    if (process.env.NODE_ENV !== 'production') {
      const keys = Object.keys(req.body || {}).filter(k => k !== 'password');
      console.log('[auth/login] body keys:', keys.join(', '), '| hasEmail:', !!email, '| hasUsername:', !!username, '| hasAgencyId:', !!agencyId);
    }

    const loginIdentifier = (email || username || '').toString().trim();
    const rawPassword = typeof password === 'string' ? password : '';
    let trimmedAgencyId = (agencyId != null && typeof agencyId === 'string') ? agencyId.trim() : '';

    // Normalize "default-agency" to the actual MVP agency ID (used by accept-invite, forgot-password, etc.)
    if (trimmedAgencyId === 'default-agency') {
      trimmedAgencyId = 'agency_1737676800000_abc123';
    }

    if (!loginIdentifier || !rawPassword) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    // Rate limiting: 5 attempts per 15 minutes per identifier
    const rateLimitKey = `login:${loginIdentifier.toLowerCase()}`;
    if (checkRateLimit(rateLimitKey, 5, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    // Find user by email or username (must provide agencyId for multi-tenant)
    if (!trimmedAgencyId) {
      return res.status(400).json({ error: 'Agency ID is required' });
    }

    // Try to find by email first
    let user = getUserByEmail(trimmedAgencyId, loginIdentifier);

    // If not found by email, try by username
    if (!user) {
      user = getUserByUsername(trimmedAgencyId, loginIdentifier);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[auth/login] user found:', !!user, '| agencyId:', trimmedAgencyId, '| identifier:', loginIdentifier.includes('@') ? '(email)' : '(username)');
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ 
        error: 'Account is not active. Please check your email for an invitation or contact support.' 
      });
    }

    // Check if user has a password set
    if (!user.passwordHash) {
      return res.status(403).json({ 
        error: 'Password not set. Please use your invitation link to set your password.' 
      });
    }

    // Verify password (use rawPassword; no trim to avoid breaking user input)
    const isValid = await verifyPassword(rawPassword, user.passwordHash);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[auth/login] password valid:', isValid);
    }
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    user.lastLoginAt = Date.now();
    saveUser(user);

    // Create JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        agencyId: user.agencyId,
        email: user.email,
        role: user.role,
        clientId: user.clientId || null
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Set httpOnly cookie
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: user.agencyId,
      actorUserId: user.id,
      action: 'auth.login',
      targetUserId: user.id,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        agencyId: user.agencyId,
        email: user.email,
        name: user.name,
        role: user.role,
        clientId: user.clientId || null
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/client-login
 * Client portal login (clientId + password). Validates against backend client credentials.
 */
router.post('/client-login', async (req, res) => {
  try {
    const { clientId: raw, password } = req.body;
    const clientId = (raw != null && typeof raw === 'string') ? raw.trim().toLowerCase() : '';
    const pwd = typeof password === 'string' ? password : '';

    if (!clientId || !pwd) {
      return res.status(400).json({ error: 'Client ID and password are required' });
    }

    const client = getClient(clientId);
    if (!client) {
      return res.status(401).json({ error: 'Invalid client ID or password' });
    }

    const stored = getClientCredentials(client.agencyId, client.id);
    if (!stored || stored !== pwd) {
      return res.status(401).json({ error: 'Invalid client ID or password' });
    }

    const clientToken = jwt.sign(
      { clientId: client.id, agencyId: client.agencyId, purpose: 'client-portal' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      client: { id: client.id, name: client.name || client.id },
      token: clientToken
    });
  } catch (e: any) {
    console.error('Client login error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Logout (clear session cookie)
 */
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

/**
 * POST /api/auth/forgot-password
 * Request password reset (always returns 200 to prevent email enumeration)
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, agencyId } = req.body;

    if (!email || !agencyId) {
      // Still return 200 to prevent email enumeration
      return res.json({ 
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.' 
      });
    }

    // Rate limiting: 3 requests per hour per email
    const rateLimitKey = `forgot-password:${email.toLowerCase()}`;
    if (checkRateLimit(rateLimitKey, 3, 60 * 60 * 1000)) {
      return res.json({ 
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.' 
      });
    }

    const user = getUserByEmail(agencyId, email);
    
    // Always return success (don't reveal if email exists)
    if (!user || user.status !== 'ACTIVE') {
      return res.json({ 
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.' 
      });
    }

    // Invalidate previous reset tokens for this user
    // (This would be done in a real implementation - for now, tokens expire after 1 hour)

    // Generate reset token
    const { token, tokenHash } = generateToken();
    const expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour

    const resetToken = {
      id: generateId('reset'),
      agencyId: user.agencyId,
      userId: user.id,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: Date.now()
    };

    savePasswordResetToken(resetToken);

    // Generate reset link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${token}&agencyId=${agencyId}`;

    // Send email (dev mode logs to console)
    await sendPasswordResetEmail(user.email, user.name, resetLink);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: user.agencyId,
      actorUserId: user.id,
      action: 'auth.forgot-password',
      targetUserId: user.id,
      createdAt: Date.now()
    });

    res.json({ 
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.',
      // In dev mode, return the link for testing
      ...(process.env.NODE_ENV !== 'production' && { resetLink })
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    // Still return success to prevent information leakage
    res.json({ 
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.' 
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using token
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword, agencyId } = req.body;

    if (!token || !newPassword || !agencyId) {
      return res.status(400).json({ error: 'Token, password, and agency ID are required' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Hash the token to look it up
    const tokenHash = hashToken(token);
    const resetToken = getPasswordResetTokenByHash(tokenHash);

    if (!resetToken || resetToken.agencyId !== agencyId) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (resetToken.usedAt) {
      return res.status(400).json({ error: 'This reset token has already been used' });
    }

    if (resetToken.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'This reset token has expired' });
    }

    // Get user
    const user = getUser(resetToken.userId);
    if (!user || user.agencyId !== agencyId) {
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);
    user.passwordHash = passwordHash;
    user.updatedAt = Date.now();
    saveUser(user);

    // Mark token as used
    markPasswordResetTokenUsed(resetToken.id);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: user.agencyId,
      actorUserId: user.id,
      action: 'auth.reset-password',
      targetUserId: user.id,
      createdAt: Date.now()
    });

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
