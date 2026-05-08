// Diagnostic startup wrapper - catches import/startup errors
import('http').then(http => {
  // Start a minimal health check server immediately
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({status: 'starting', error: global.__startupError || null}));
    }
  });
  // Don't listen on the main port - just log
  console.log('[start.js] Loading main server...');

  import('./dist/server.js').then(() => {
    console.log('[start.js] Main server loaded successfully');
  }).catch(err => {
    console.error('[start.js] FATAL: Main server failed to load:', err);
    global.__startupError = err.message + '\n' + err.stack;
    // Start a diagnostic server on the main port
    const PORT = process.env.PORT || 3001;
    const diagServer = http.createServer((req, res) => {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        error: 'Server failed to start',
        message: err.message,
        stack: err.stack
      }));
    });
    diagServer.listen(PORT, () => {
      console.log(`[start.js] Diagnostic server on port ${PORT}`);
    });
  });
});
