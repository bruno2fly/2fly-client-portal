import http from 'http';
const PORT = process.env.PORT || 3001;
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello from start.js');
}).listen(PORT, () => console.log('Listening on ' + PORT));
