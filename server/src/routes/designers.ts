/**
 * Designer management (agency-only).
 * Designers are users with role DESIGNER. List/create/update/delete.
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireProductionAccess, requireAgencyOnly } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  getUsersByAgency,
  getUser,
  saveUser,
  deleteUser,
  getUserByEmail,
  getInviteTokensByUser,
  saveInviteToken,
  markInviteTokenUsed,
  saveAuditLog,
} from '../db.js';
import { generateId, generateToken, hashPassword, generateUsernameFromEmail, generateRandomPassword } from '../utils/auth.js';
import { sendInviteEmail } from '../utils/email.js';
import type { User } from '../types.js';

const router = Router();

/** GET /api/designers — List agency designers (agency staff and designers can list). */
router.get('/', authenticate, requireProductionAccess, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const users = getUsersByAgency(agencyId).filter((u: User) => u.role === 'DESIGNER');
    const result: any = {
      success: true,
      designers: users.map((u: User) => ({
        id: u.id,
        agencyId: u.agencyId,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
      })),
    };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list designers' });
  }
});

/** POST /api/designers — Create designer (agency admin only). Invite flow. */
router.post('/', authenticate, requireAgencyOnly, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { email, name } = req.body || {};
    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }
    const existing = getUserByEmail(agencyId, email);
    if (existing) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    const userId = generateId('user');
    const newUser: User = {
      id: userId,
      agencyId,
      email: String(email).toLowerCase(),
      name: String(name).trim(),
      role: 'DESIGNER',
      status: 'INVITED',
      passwordHash: null,
      clientId: null,
      lastLoginAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveUser(newUser);

    const { token, tokenHash } = generateToken();
    const expiresAt = Date.now() + 72 * 60 * 60 * 1000;
    const inviteToken = {
      id: generateId('invite'),
      agencyId,
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: Date.now(),
    };
    saveInviteToken(inviteToken);

    const frontendUrl = process.env.FRONTEND_URL || 'https://2flyflow.com';
    const inviteLink = `${frontendUrl}/accept-invite?token=${token}&agencyId=${agencyId}`;
    await sendInviteEmail(newUser.email, newUser.name, inviteLink);

    saveAuditLog({
      id: generateId('audit'),
      agencyId,
      actorUserId: (req as any).user.id,
      action: 'designer.invite',
      targetUserId: userId,
      metaJson: undefined,
      createdAt: Date.now(),
    });

    const result: any = {
      success: true,
      designer: {
        id: newUser.id,
        agencyId: newUser.agencyId,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.createdAt,
      },
    };
    res.status(201).json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to create designer' });
  }
});

/** PUT /api/designers/:id — Update designer (agency only). */
router.put('/:id', authenticate, requireAgencyOnly, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { id } = req.params;
    const { name, email } = req.body || {};
    const user = getUser(id);
    if (!user || user.agencyId !== agencyId || user.role !== 'DESIGNER') {
      return res.status(404).json({ error: 'Designer not found' });
    }
    if (name != null) user.name = String(name).trim();
    if (email != null) user.email = String(email).toLowerCase();
    user.updatedAt = Date.now();
    saveUser(user);
    const result: any = {
      success: true,
      designer: {
        id: user.id,
        agencyId: user.agencyId,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      },
    };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update designer' });
  }
});

/** DELETE /api/designers/:id — Remove designer (agency only). */
router.delete('/:id', authenticate, requireAgencyOnly, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { id } = req.params;
    const user = getUser(id);
    if (!user || user.agencyId !== agencyId || user.role !== 'DESIGNER') {
      return res.status(404).json({ error: 'Designer not found' });
    }
    deleteUser(id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to delete designer' });
  }
});

export default router;
