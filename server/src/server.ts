/**
 * 2Fly Server
 * Main Express server
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { join } from 'path';
import googleDriveRoutes from './routes/googleDrive.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
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

// API routes
app.use('/api/integrations/google-drive', googleDriveRoutes);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 2Fly Server running on http://localhost:${PORT}`);
  console.log(`📁 Uploads directory: ${join(process.cwd(), 'uploads')}`);
  console.log(`💾 Data directory: ${join(process.cwd(), 'data')}`);
});

