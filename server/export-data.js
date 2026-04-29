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
  } else if (req.url.startsWith('/file/')) {
    // Serve a single file by name: /file/clients.json
    const filename = decodeURIComponent(req.url.slice(6));
    const filePath = path.join(DATA_DIR, filename);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      res.end(raw);
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.url === '/dump-small') {
    // Return all JSON files EXCEPT portal-state (too large)
    const result = {};
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.includes('portal-state') && !f.includes('.bak'));
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
  } else if (req.url === '/portal-state-keys') {
    // Return just the top-level keys of portal-state.json (avoids loading 155MB into response)
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, 'portal-state.json'), 'utf-8');
      const data = JSON.parse(raw);
      const keys = Object.keys(data);
      res.end(JSON.stringify(keys));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.url.startsWith('/portal-state-entry/')) {
    // Serve a single portal-state entry by key: /portal-state-entry/agencyId:clientId
    const key = decodeURIComponent(req.url.slice('/portal-state-entry/'.length));
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, 'portal-state.json'), 'utf-8');
      const data = JSON.parse(raw);
      if (key in data) {
        res.end(JSON.stringify(data[key]));
      } else {
        res.end(JSON.stringify({ error: `Key "${key}" not found`, availableKeys: Object.keys(data) }));
      }
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.url.startsWith('/portal-state-fields/')) {
    // Return top-level field names of a portal-state entry
    const key = decodeURIComponent(req.url.slice('/portal-state-fields/'.length));
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, 'portal-state.json'), 'utf-8');
      const data = JSON.parse(raw);
      if (key in data) {
        const entry = data[key];
        const fields = Object.keys(entry).map(f => ({
          name: f,
          size: JSON.stringify(entry[f]).length,
        }));
        res.end(JSON.stringify(fields));
      } else {
        res.end(JSON.stringify({ error: `Key "${key}" not found` }));
      }
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.url.startsWith('/portal-state-field/')) {
    // Serve a single field of a portal-state entry: /portal-state-field/agencyId:clientId/fieldName
    const rest = decodeURIComponent(req.url.slice('/portal-state-field/'.length));
    const lastSlash = rest.lastIndexOf('/');
    const key = rest.slice(0, lastSlash);
    const field = rest.slice(lastSlash + 1);
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, 'portal-state.json'), 'utf-8');
      const data = JSON.parse(raw);
      if (key in data && field in data[key]) {
        res.end(JSON.stringify(data[key][field]));
      } else {
        res.end(JSON.stringify({ error: `Field "${field}" not found in "${key}"` }));
      }
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
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
    res.end(JSON.stringify({ status: 'ok', endpoints: ['/dump', '/dump-small', '/ls', '/file/:name', '/portal-state-keys', '/portal-state-entry/:key'] }));
  }
});

server.listen(PORT, () => console.log(`Export server on port ${PORT}`));
