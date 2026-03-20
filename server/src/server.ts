/**
 * 2Fly Server
 * Main Express server
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import googleDriveRoutes from './routes/googleDrive.js';
import metaAuthRoutes from './routes/metaAuth.js';
import metaRoutes from './routes/meta.js';
import postsRoutes from './routes/posts.js';
import cronRoutes from './routes/cron.js';
import uploadRoutes from './routes/upload.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import agencyRoutes from './routes/agency.js';
import clientPortalRoutes from './routes/clientPortal.js';
import productionRoutes from './routes/production.js';
import designersRoutes from './routes/designers.js';
import aiCopilotRoutes from './routes/aiCopilot.js';
import aiImageGenRoutes from './routes/aiImageGen.js';
import type { UserRole } from './types.js';
import { authenticate, requireCanManageUsers } from './middleware/auth.js';
import { getAgencies, getUsersByAgency, getInviteTokensByUser, saveInviteToken, markInviteTokenUsed, getUserByEmail, saveUser, saveAuditLog } from './db.js';
import { generateToken, generateId, generateUsernameFromEmail, generateRandomPassword, hashPassword } from './utils/auth.js';
import { sendCredentialsEmail } from './utils/email.js';
import { clearRateLimit, clearAllRateLimits } from './utils/rateLimit.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration
// In development allow any localhost origin (Vite may use 5173, 5174, etc.)
// In production: allow FRONTEND_URL and production domains for cross-origin (2flyflow.com -> api.2flyflow.com)
const prodOrigins = [
  process.env.FRONTEND_URL,
  'https://2flyflow.com',
  'https://www.2flyflow.com'
].filter(Boolean);
const allowedOrigins = process.env.NODE_ENV === 'development'
  ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:8000', 'http://127.0.0.1:8000', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174']
  : (prodOrigins.length > 0 ? prodOrigins : ['https://2flyflow.com']);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    // In development, allow any localhost:* origin so any dev port works
    if (process.env.NODE_ENV === 'development' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(cookieParser());
// Security headers
if (process.env.NODE_ENV === 'production') {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow images served cross-origin
  }));
}
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Serve uploaded files
app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: '2Fly Server API',
    version: '1.0.0',
      endpoints: {
        health: '/health',
        auth: {
          login: '/api/auth/login',
          clientLogin: '/api/auth/client-login',
          logout: '/api/auth/logout',
          forgotPassword: '/api/auth/forgot-password',
          resetPassword: '/api/auth/reset-password'
        },
        client: {
          portalState: 'GET/PUT /api/client/portal-state (Bearer token)'
        },
        users: {
          invite: '/api/users/invite',
          resendInvite: '/api/users/resend-invite',
          acceptInvite: '/api/users/accept-invite',
          list: '/api/users',
          update: '/api/users/:id',
          delete: '/api/users/:id'
        },
        googleDrive: {
          connect: '/api/integrations/google-drive/connect',
          callback: '/api/integrations/google-drive/callback',
          status: '/api/integrations/google-drive/status',
          import: '/api/integrations/google-drive/import',
          disconnect: '/api/integrations/google-drive/disconnect',
          accessToken: '/api/integrations/google-drive/access-token'
        },
        meta: {
          connect: '/api/auth/meta',
          callback: '/api/auth/meta/callback',
          status: '/api/integrations/meta/status',
          disconnect: '/api/integrations/meta/disconnect'
        },
        posts: {
          schedule: 'POST /api/posts/schedule',
          scheduled: 'GET /api/posts/scheduled',
          reschedule: 'PUT /api/posts/:id/reschedule',
          cancel: 'DELETE /api/posts/:id/cancel',
          publishNow: 'POST /api/posts/:id/publish-now'
        },
        cron: '/api/cron/publish-posts',
        upload: 'POST /api/upload/image'
      }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Dev-only: Clear rate limits (for testing)
app.post('/api/dev/clear-rate-limits', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is only available in development' });
  }
  
  const { key } = req.body;
  
  if (key) {
    clearRateLimit(key);
    res.json({ success: true, message: `Rate limit cleared for key: ${key}` });
  } else {
    clearAllRateLimits();
    res.json({ success: true, message: 'All rate limits cleared' });
  }
});

// Dev-only: Generate invite link for owner user (for initial setup)
// ⚠️ Remove this in production or add authentication
app.get('/api/dev/generate-owner-invite', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is only available in development' });
  }

  try {
    // Find owner user with INVITED status
    const agencies = getAgencies();
    const agencyList = Object.values(agencies);
    if (agencyList.length === 0) {
      return res.status(404).json({ error: 'No agency found. Run setup first.' });
    }

    const agencyId = agencyList[0].id;
    const users = getUsersByAgency(agencyId);
    const ownerUser = users.find(u => u.role === 'OWNER' && u.status === 'INVITED');

    if (!ownerUser) {
      return res.status(404).json({ 
        error: 'No INVITED owner user found',
        hint: 'Owner user may already be active or needs to be created'
      });
    }

    // Invalidate old tokens
    const oldTokens = getInviteTokensByUser(ownerUser.id);
    oldTokens.forEach(t => {
      if (!t.usedAt && t.expiresAt > Date.now()) {
        markInviteTokenUsed(t.id);
      }
    });

    // Generate new token
    const { token, tokenHash } = generateToken();
    const expiresAt = Date.now() + (72 * 60 * 60 * 1000); // 72 hours

    const inviteToken = {
      id: generateId('invite'),
      agencyId: ownerUser.agencyId,
      userId: ownerUser.id,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: Date.now()
    };

    saveInviteToken(inviteToken);

    // Generate invite link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8000';
    const inviteLink = `${frontendUrl}/accept-invite.html?token=${token}&agencyId=${ownerUser.agencyId}`;

    res.json({
      success: true,
      inviteLink,
      user: {
        email: ownerUser.email,
        name: ownerUser.name,
        agencyId: ownerUser.agencyId
      },
      expiresAt: new Date(expiresAt).toISOString()
    });
  } catch (error: any) {
    console.error('Generate owner invite error:', error);
    res.status(500).json({ error: 'Failed to generate invite link', message: error.message });
  }
});

// PIN-based invite endpoint (for agency staff creation). OWNER/ADMIN only; staff share actor's agencyId.
// PIN: 747800
app.post('/api/users/invite-with-pin', authenticate, requireCanManageUsers, async (req: any, res) => {
  try {
    const { email, pin, name, password: customPassword, role: roleParam } = req.body;
    const REQUIRED_PIN = '747800';

    if (!email || !pin) {
      return res.status(400).json({ error: 'Email and PIN are required' });
    }

    if (pin !== REQUIRED_PIN) {
      return res.status(403).json({ error: 'Invalid PIN' });
    }

    const raw = (customPassword != null && typeof customPassword === 'string') ? customPassword.trim() : '';
    if (raw.length > 0 && raw.length < 8) {
      return res.status(400).json({ error: 'Custom password must be at least 8 characters' });
    }

    const roleInput: UserRole = (roleParam === 'designer' || roleParam === 'DESIGNER') ? 'DESIGNER' : 'STAFF';

    const targetAgencyId = req.user!.agencyId;
    if (!targetAgencyId) {
      return res.status(400).json({ error: 'Agency ID is required. Staff must belong to your agency.' });
    }

    const existingUser = getUserByEmail(targetAgencyId, email);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    let username = generateUsernameFromEmail(email);
    let counter = 1;
    let finalUsername = username;
    const existingUsernames = getUsersByAgency(targetAgencyId).map(u => {
      return u.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    });
    while (existingUsernames.includes(finalUsername)) {
      finalUsername = `${username}${counter}`;
      counter++;
    }

    const password = raw.length >= 8 ? raw : generateRandomPassword(12);
    const passwordHash = await hashPassword(password);

    // Create user
    const userId = generateId('user');
    const userName = name || email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim() || 'User';
    
    const newUser = {
      id: userId,
      agencyId: targetAgencyId,
      email: email.toLowerCase(),
      username: finalUsername, // Store username for login
      name: name,
      role: roleInput,
      status: 'ACTIVE' as const,
      passwordHash: passwordHash,
      tempPassword: process.env.NODE_ENV !== 'production' ? password : undefined, // Store temp password in dev mode only
      clientId: null,
      lastLoginAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    saveUser(newUser);

    // Send credentials email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8000';
    const loginUrl = `${frontendUrl}/staff-login.html`;
    
    await sendCredentialsEmail(email, userName, finalUsername, password, loginUrl);

    // Log audit
    saveAuditLog({
      id: generateId('audit'),
      agencyId: targetAgencyId,
      actorUserId: req.user!.id,
      action: 'user.invite-with-pin',
      targetUserId: userId,
      metaJson: JSON.stringify({ method: 'pin', email }),
      createdAt: Date.now()
    });

    res.json({
      success: true,
      message: 'User created and credentials sent via email',
      user: {
        id: userId,
        email: newUser.email,
        name: newUser.name,
        username: finalUsername,
        role: roleInput
      },
      // In dev mode, return credentials
      ...(process.env.NODE_ENV !== 'production' && {
        credentials: {
          username: finalUsername,
          password: password
        }
      })
    });
  } catch (error: any) {
    console.error('PIN invite error:', error);
    res.status(500).json({ error: 'Failed to create user', message: error.message });
  }
});

// API routes
app.use('/api/integrations/google-drive', googleDriveRoutes);
app.use('/api/integrations/meta', metaRoutes);
app.use('/api/auth/meta', metaAuthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/agency', agencyRoutes);
app.use('/api/client', clientPortalRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/designers', designersRoutes);
app.use('/api/ai-copilot', aiCopilotRoutes);
app.use('/api/ai', aiImageGenRoutes);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server with error handling
const server = app.listen(PORT, () => {
  console.log(`🚀 2Fly Server running on http://localhost:${PORT}`);
  console.log(`📁 Uploads directory: ${join(process.cwd(), 'uploads')}`);
  console.log(`💾 Data directory: ${join(process.cwd(), 'data')}`);
});

// Increase server timeouts for long-running requests (AI image generation)
server.timeout = 120000;       // 2 minutes
server.keepAliveTimeout = 120000;

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use.`);
    console.error('💡 To fix this, run: lsof -ti:3001 | xargs kill -9');
    console.error('   Or use a different port by setting PORT environment variable.');
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
    throw err;
  }
});

