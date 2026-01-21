/**
 * Authentication middleware
 * 
 * MVP: Simple session-based auth using localStorage data
 * Production: Use JWT tokens, refresh tokens, etc.
 */

import type { Request, Response, NextFunction } from 'express';
import { getStaffById, getStaffByUsername } from '../db.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  workspaceId?: string;
  staff?: {
    id: string;
    username: string;
    fullName: string;
    email: string;
    workspaceId: string;
  };
}

/**
 * Extract user info from session header
 * In production, validate JWT token
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // MVP: Get user info from X-User-Id and X-Workspace-Id headers
  // In production, validate JWT token from Authorization header
  const userId = req.headers['x-user-id'] as string;
  const workspaceId = req.headers['x-workspace-id'] as string;
  
  if (!userId || !workspaceId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // For MVP: Allow access with any userId/workspaceId combination
  // In production, validate against database
  // Try to find staff by ID first, then by username
  let staff = getStaffById(userId);
  if (!staff) {
    // If not found by ID, try by username
    staff = getStaffByUsername(userId);
  }
  
  // For MVP: If staff doesn't exist, allow access anyway with provided credentials
  // This allows testing without creating staff records in the database
  if (!staff) {
    req.userId = userId;
    req.workspaceId = workspaceId;
    req.staff = {
      id: userId,
      username: userId,
      fullName: 'User',
      email: '',
      workspaceId: workspaceId
    };
    return next();
  }
  
  // If staff exists, use their actual data
  req.userId = staff.id;
  req.workspaceId = workspaceId || staff.workspaceId || 'default-workspace';
  req.staff = {
    id: staff.id,
    username: staff.username,
    fullName: staff.fullName,
    email: staff.email,
    workspaceId: req.workspaceId
  };
  
  next();
}

