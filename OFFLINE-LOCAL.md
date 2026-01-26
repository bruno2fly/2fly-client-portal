# Run 2Fly Client Portal Offline (Local)

No npm or Node.js needed. Uses Python only.

## 1. Start the server

In Terminal:

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
./start-server.sh
```

Or manually:

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/public
python3 -m http.server 8000
```

## 2. Open in browser

| Page | URL |
|------|-----|
| **Staff login** | http://localhost:8000/staff-login.html |
| **Agency dashboard** | http://localhost:8000/agency.html |
| Client login | http://localhost:8000/login.html |
| Client portal | http://localhost:8000/index.html |

## 3. Stop the server

Press **Ctrl+C** in the terminal.

---

**Note:** Redirects use `.html` paths on localhost so everything works without Vercel rewrites. Staff login → Agency and Agency logout → Staff login both work offline.
