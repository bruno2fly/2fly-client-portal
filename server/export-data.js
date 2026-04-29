// Temporary data export server — reads JSON files from Railway Volume and serves them
// No Prisma dependency. Start command: node export-data.js
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/dump') {
    // Return all JSON files as one big object
    const result = {};
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
          result[f] = raw.trim() ? JSON.parse(raw) : {};
        } catch (e) {
          result[f] = { _error: e.message };
        }
      }
      res.end(JSON.stringify(result));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message, dataDir: DATA_DIR }));
    }
  } else if (req.url === '/ls') {
    try {
      const files = fs.readdirSync(DATA_DIR);
      const details = files.map(f => {
        const stat = fs.statSync(path.join(DATA_DIR, f));
        return { name: f, size: stat.size };
      });
      res.end(JSON.stringify(details));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message, dataDir: DATA_DIR }));
    }
  } else {
    res.end(JSON.stringify({ status: 'ok', endpoints: ['/dump', '/ls'] }));
  }
});

server.listen(PORT, () => console.log(`Export server on port ${PORT}`));
