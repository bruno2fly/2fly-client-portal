/**
 * 2Fly Server
 * Main Express server
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import googleDriveRoutes from './routes/googleDrive.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import { getAgencies, getUsersByAgency, getInviteTokensByUser, saveInviteToken, markInviteTokenUsed, getUserByEmail, saveUser, saveAuditLog } from './db.js';
import { generateToken, generateId, generateUsernameFromEmail, generateRandomPassword, hashPassword } from './utils/auth.js';
import { sendCredentialsEmail } from './utils/email.js';
import { clearRateLimit, clearAllRateLimits } from './utils/rateLimit.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration
// Allow both Vite dev server (5173) and Python server (8000) in development
const allowedOrigins = process.env.NODE_ENV === 'development'
  ? ['http://localhost:5173', 'http://localhost:8000', 'http://127.0.0.1:8000']
  : [process.env.FRONTEND_URL || 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
          logout: '/api/auth/logout',
          forgotPassword: '/api/auth/forgot-password',
          resetPassword: '/api/auth/reset-password'
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
        }
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

// PIN-based invite endpoint (for agency staff creation)
// PIN: 747800
app.post('/api/users/invite-with-pin', async (req, res) => {
  try {
    const { email, pin, agencyId, name } = req.body;
    const REQUIRED_PIN = '747800';

    if (!email || !pin) {
      return res.status(400).json({ error: 'Email and PIN are required' });
    }

    if (pin !== REQUIRED_PIN) {
      return res.status(403).json({ error: 'Invalid PIN' });
    }

    // Get or use default agency
    let targetAgencyId = agencyId;
    if (!targetAgencyId) {
      const agencies = getAgencies();
      const agencyList = Object.values(agencies);
      if (agencyList.length === 0) {
        return res.status(404).json({ error: 'No agency found. Run setup first.' });
      }
      targetAgencyId = agencyList[0].id;
    }

    // Check if user already exists
    const existingUser = getUserByEmail(targetAgencyId, email);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Generate username from email (for display/email purposes)
    // The system uses email for login, so username is just for display
    let username = generateUsernameFromEmail(email);
    // Make username unique if needed (for display purposes only)
    let counter = 1;
    let finalUsername = username;
    const existingUsernames = getUsersByAgency(targetAgencyId).map(u => {
      // Extract username from email for comparison
      return u.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    });
    while (existingUsernames.includes(finalUsername)) {
      finalUsername = `${username}${counter}`;
      counter++;
    }

    // Generate random password
    const password = generateRandomPassword(12);
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
      role: 'STAFF' as const,
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
      actorUserId: 'system', // System-generated
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
        username: finalUsername
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
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

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

