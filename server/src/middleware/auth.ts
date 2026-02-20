/**
 * Authentication middleware
 * 
 * Supports both legacy header-based auth (for backward compatibility)
 * and new JWT cookie-based auth
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getStaffById, getStaffByUsername, getUser } from '../db.js';
import type { UserRole } from '../types.js';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && !secret) {
    throw new Error('JWT_SECRET must be set in production');
  }
  return secret || 'change-me-in-production-use-strong-secret';
}
const JWT_SECRET = getJwtSecret();
const COOKIE_NAME = '2fly_session';

export interface AuthScope {
  userId: string;
  agencyId: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  workspaceId?: string;
  agencyId?: string;
  /** Dev Notes: Dashboard is agencyId-scoped; only personal preferences use userId. */
  auth?: AuthScope;
  staff?: {
    id: string;
    username: string;
    fullName: string;
    email: string;
    workspaceId: string;
  };
  user?: {
    id: string;
    agencyId: string;
    email: string;
    name: string;
    role: UserRole;
    clientId?: string | null;
  };
}

/** Use in every service/repo: scope dashboard data by agencyId, not userId. */
export function getAgencyScope(req: AuthenticatedRequest): { agencyId: string } {
  const aid = req.auth?.agencyId ?? req.user?.agencyId ?? req.agencyId;
  if (!aid) throw new Error('Missing agencyId');
  return { agencyId: aid };
}

/**
 * Extract user info from JWT cookie or legacy headers
 * Supports both new credentials system and legacy staff system
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Try JWT cookie first (new credentials system)
    const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        
        // Get user from database
        const user = getUser(decoded.userId);
        if (!user || user.agencyId !== decoded.agencyId) {
          return res.status(401).json({ error: 'Invalid session' });
        }

        // Check if user is active
        if (user.status !== 'ACTIVE') {
          return res.status(403).json({ error: 'Account is not active' });
        }

        req.userId = user.id;
        req.agencyId = user.agencyId;
        req.user = {
          id: user.id,
          agencyId: user.agencyId,
          email: user.email,
          name: user.name,
          role: user.role,
          clientId: user.clientId || null
        };
        req.workspaceId = user.agencyId;
        req.auth = { userId: user.id, agencyId: user.agencyId, role: user.role };

        return next();
      } catch (jwtError) {
        // JWT invalid, fall through to legacy auth
      }
    }

    // Legacy: Get user info from X-User-Id and X-Workspace-Id headers
    const userId = req.headers['x-user-id'] as string;
    const workspaceId = req.headers['x-workspace-id'] as string;
    
    if (!userId || !workspaceId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Try to find staff by ID first, then by username
    let staff = getStaffById(userId);
    if (!staff) {
      staff = getStaffByUsername(userId);
    }
    
    // For MVP: If staff doesn't exist, allow access anyway with provided credentials
    // This allows testing without creating staff records in the database
    if (!staff) {
      req.userId = userId;
      req.workspaceId = workspaceId;
      req.agencyId = workspaceId;
      req.auth = { userId, agencyId: workspaceId, role: 'STAFF' as UserRole };
      req.staff = {
        id: userId,
        username: userId,
        fullName: 'User',
        email: '',
        workspaceId: workspaceId
      };
      return next();
    }
    req.userId = staff.id;
    req.workspaceId = workspaceId || staff.workspaceId || 'default-workspace';
    req.agencyId = req.workspaceId;
    req.auth = { userId: staff.id, agencyId: req.workspaceId, role: 'STAFF' as UserRole };
    req.staff = {
      id: staff.id,
      username: staff.username,
      fullName: staff.fullName,
      email: staff.email,
      workspaceId: req.workspaceId
    };
    next();
  } catch (error: any) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Require specific role(s) - must be used after authenticate()
 */
export function requireRole(roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

export function requireOwner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireRole(['OWNER'])(req, res, next);
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireRole(['OWNER', 'ADMIN'])(req, res, next);
}

/** Can invite/delete/update users. Dashboard user-management only. */
export function requireCanManageUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireRole(['OWNER', 'ADMIN'])(req, res, next);
}

/** Can view agency dashboard (clients, tasks, etc.). All staff share same view. */
export function requireCanViewDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireRole(['OWNER', 'ADMIN', 'STAFF'])(req, res, next);
}
