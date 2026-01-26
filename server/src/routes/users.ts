/**
 * User management routes (admin/owner only)
 * POST /api/users/invite
 * POST /api/users/resend-invite
 * POST /api/users/accept-invite
 * GET /api/users
 * PATCH /api/users/:id
 * DELETE /api/users/:id
 */

import express from 'express';
import { getUser, getUserByEmail, getUsersByAgency, getUsersByClient, saveUser, deleteUser, getInviteTokensByUser, saveInviteToken, getInviteTokenByHash, markInviteTokenUsed, saveAuditLog, getClientsByAgency } from '../db.js';
import { hashPassword, generateToken, hashToken, generateId } from '../utils/auth.js';
import { sendInviteEmail } from '../utils/email.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { User, UserRole, UserStatus } from '../types.js';

const router = express.Router();

/**
 * POST /api/users/invite
 * Invite a new user (OWNER/ADMIN only)
 */
router.post('/invite', authenticate, requireRole(['OWNER', 'ADMIN']), async (req: any, res) => {
  try {
    const { email, name, role, clientId } = req.body;
    const actorUser = req.user;

    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, name, and role are required' });
    }

    // Validate role
    const validRoles: UserRole[] = ['OWNER', 'ADMIN', 'STAFF', 'CLIENT'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // If role is CLIENT, clientId is required
    if (role === 'CLIENT' && !clientId) {
      return res.status(400).json({ error: 'Client ID is required for CLIENT role' });
    }

    // Check if user already exists in this agency
    const existingUser = getUserByEmail(actorUser.agencyId, email);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists in this agency' });
    }

    // If CLIENT role, verify client exists and belongs to agency
    if (role === 'CLIENT' && clientId) {
      const clients = getClientsByAgency(actorUser.agencyId);
      const client = clients.find(c => c.id === clientId);
      if (!client) {
        return res.status(400).json({ error: 'Client not found or does not belong to this agency' });
      }
    }

    // Create user with INVITED status
    const userId = generateId('user');
    const newUser: User = {
      id: userId,
      agencyId: actorUser.agencyId,
      email: email.toLowerCase(),
      name,
      role,
      status: 'INVITED',
      passwordHash: null,
      clientId: role === 'CLIENT' ? clientId : null,
      lastLoginAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    saveUser(newUser);

    // Generate invite token
    const { token, tokenHash } = generateToken();
    const expiresAt = Date.now() + (72 * 60 * 60 * 1000); // 72 hours

    // Invalidate previous invite tokens for this user
    const previousTokens = getInviteTokensByUser(userId);
    previousTokens.forEach(t => {
      if (!t.usedAt && t.expiresAt > Date.now()) {
        markInviteTokenUsed(t.id);
      }
    });

    const inviteToken = {
      id: generateId('invite'),
      agencyId: actorUser.agencyId,
      userId: userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: Date.now()
    };

    saveInviteToken(inviteToken);

    // Generate invite link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const inviteLink = `${frontendUrl}/accept-invite?token=${token}&agencyId=${actorUser.agencyId}`;

    // Send email (dev mode logs to console)
    await sendInviteEmail(newUser.email, newUser.name, inviteLink);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: actorUser.agencyId,
      actorUserId: actorUser.id,
      action: 'user.invite',
      targetUserId: userId,
      metaJson: JSON.stringify({ role, clientId: clientId || null }),
      createdAt: Date.now()
    });

    res.json({
      success: true,
      user: {
        id: userId,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        status: newUser.status
      },
      inviteLink: process.env.NODE_ENV !== 'production' ? inviteLink : undefined
    });
  } catch (error: any) {
    console.error('Invite user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/users/resend-invite
 * Resend invitation to a user (OWNER/ADMIN only)
 */
router.post('/resend-invite', authenticate, requireRole(['OWNER', 'ADMIN']), async (req: any, res) => {
  try {
    const { userId } = req.body;
    const actorUser = req.user;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = getUser(userId);
    if (!user || user.agencyId !== actorUser.agencyId) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.status !== 'INVITED') {
      return res.status(400).json({ error: 'User is not in INVITED status' });
    }

    // Generate new invite token
    const { token, tokenHash } = generateToken();
    const expiresAt = Date.now() + (72 * 60 * 60 * 1000); // 72 hours

    // Invalidate previous invite tokens
    const previousTokens = getInviteTokensByUser(userId);
    previousTokens.forEach(t => {
      if (!t.usedAt && t.expiresAt > Date.now()) {
        markInviteTokenUsed(t.id);
      }
    });

    const inviteToken = {
      id: generateId('invite'),
      agencyId: actorUser.agencyId,
      userId: userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: Date.now()
    };

    saveInviteToken(inviteToken);

    // Generate invite link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const inviteLink = `${frontendUrl}/accept-invite?token=${token}&agencyId=${actorUser.agencyId}`;

    // Send email
    await sendInviteEmail(user.email, user.name, inviteLink);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: actorUser.agencyId,
      actorUserId: actorUser.id,
      action: 'user.resend-invite',
      targetUserId: userId,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      inviteLink: process.env.NODE_ENV !== 'production' ? inviteLink : undefined
    });
  } catch (error: any) {
    console.error('Resend invite error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/users/accept-invite
 * Accept invitation and set password
 */
router.post('/accept-invite', async (req, res) => {
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
    const inviteToken = getInviteTokenByHash(tokenHash);

    if (!inviteToken || inviteToken.agencyId !== agencyId) {
      return res.status(400).json({ error: 'Invalid or expired invitation token' });
    }

    if (inviteToken.usedAt) {
      return res.status(400).json({ error: 'This invitation has already been used' });
    }

    if (inviteToken.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }

    // Get user
    const user = getUser(inviteToken.userId);
    if (!user || user.agencyId !== agencyId) {
      return res.status(400).json({ error: 'Invalid invitation token' });
    }

    if (user.status !== 'INVITED') {
      return res.status(400).json({ error: 'User is not in INVITED status' });
    }

    // Hash password and activate user
    const passwordHash = await hashPassword(newPassword);
    user.passwordHash = passwordHash;
    user.status = 'ACTIVE';
    user.updatedAt = Date.now();
    saveUser(user);

    // Mark token as used
    markInviteTokenUsed(inviteToken.id);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: user.agencyId,
      actorUserId: user.id,
      action: 'user.accept-invite',
      targetUserId: user.id,
      createdAt: Date.now()
    });

    res.json({ success: true, message: 'Invitation accepted. You can now log in.' });
  } catch (error: any) {
    console.error('Accept invite error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/users
 * List users in agency (scoped to agency)
 */
router.get('/', authenticate, async (req: any, res) => {
  try {
    const { role, status, clientId } = req.query;
    const actorUser = req.user;

    let users = getUsersByAgency(actorUser.agencyId);

    // Filter by role
    if (role) {
      users = users.filter(u => u.role === role);
    }

    // Filter by status
    if (status) {
      users = users.filter(u => u.status === status);
    }

    // Filter by client (for CLIENT role)
    if (clientId) {
      users = users.filter(u => u.clientId === clientId);
    }

    // Return users without sensitive data (but include tempPassword in dev mode)
    res.json({
      success: true,
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        username: u.username || u.email.split('@')[0], // Include username
        name: u.name,
        role: u.role,
        status: u.status,
        password: process.env.NODE_ENV !== 'production' ? u.tempPassword : undefined, // Include temp password in dev mode only
        clientId: u.clientId || null,
        lastLoginAt: u.lastLoginAt || null,
        createdAt: u.createdAt
      }))
    });
  } catch (error: any) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/users/:id
 * Update user (OWNER/ADMIN only, with restrictions)
 */
router.patch('/:id', authenticate, requireRole(['OWNER', 'ADMIN']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { role, status } = req.body;
    const actorUser = req.user;

    const user = getUser(id);
    if (!user || user.agencyId !== actorUser.agencyId) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only OWNER can change roles to OWNER or ADMIN
    if (role && (role === 'OWNER' || role === 'ADMIN')) {
      if (actorUser.role !== 'OWNER') {
        return res.status(403).json({ error: 'Only OWNER can assign OWNER or ADMIN roles' });
      }
    }

    // Prevent disabling/deleting the last OWNER
    if (status === 'DISABLED' && user.role === 'OWNER') {
      const owners = getUsersByAgency(actorUser.agencyId).filter(u => u.role === 'OWNER' && u.status === 'ACTIVE');
      if (owners.length <= 1) {
        return res.status(400).json({ error: 'Cannot disable the last active OWNER' });
      }
    }

    // Update user
    if (role) user.role = role;
    if (status) user.status = status;
    user.updatedAt = Date.now();
    saveUser(user);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: actorUser.agencyId,
      actorUserId: actorUser.id,
      action: 'user.update',
      targetUserId: id,
      metaJson: JSON.stringify({ role: role || null, status: status || null }),
      createdAt: Date.now()
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        clientId: user.clientId || null
      }
    });
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/users/:id
 * Delete user (soft delete via status=DISABLED) (OWNER/ADMIN only)
 */
router.delete('/:id', authenticate, requireRole(['OWNER', 'ADMIN']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const actorUser = req.user;

    const user = getUser(id);
    if (!user || user.agencyId !== actorUser.agencyId) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting the last OWNER
    if (user.role === 'OWNER') {
      const owners = getUsersByAgency(actorUser.agencyId).filter(u => u.role === 'OWNER' && u.status === 'ACTIVE');
      if (owners.length <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last active OWNER' });
      }
    }

    // Soft delete: set status to DISABLED
    user.status = 'DISABLED';
    user.updatedAt = Date.now();
    saveUser(user);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: actorUser.agencyId,
      actorUserId: actorUser.id,
      action: 'user.delete',
      targetUserId: id,
      createdAt: Date.now()
    });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
