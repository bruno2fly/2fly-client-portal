// Diagnostic startup wrapper - catches import/startup errors
console.log('[start.js] Loading main server...');
import('./dist/server.js').then(() => {
  console.log('[start.js] Main server loaded OK');
}).catch(err => {
  console.error('[start.js] FATAL ERROR loading server:', err.message);
  console.error('[start.js] Stack:', err.stack);
  // Start a diagnostic server so we can see the error
  import('http').then(http => {
    const PORT = process.env.PORT || 3001;
    const errInfo = { error: 'Server failed to start', message: err.message, stack: err.stack };
    http.createServer((req, res) => {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(errInfo));
    }).listen(PORT, () => {
      console.log(`[start.js] Diagnostic error server on port ${PORT}`);
    });
  });
});
