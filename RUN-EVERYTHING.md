# Run local + push to Git + deploy to Vercel

**One command (run in your Terminal):**

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
bash do-everything.sh
```

This will:

1. **Start local servers** (background)
   - Frontend: http://localhost:8000  
   - Backend: http://localhost:3001  
   - Logs: `/tmp/2fly-frontend.log`, `/tmp/2fly-backend.log`

2. **Push to Git** (commit if needed, then `git push origin main`)

3. **Deploy to Vercel** (`npx vercel --prod`)

---

**Alternatives:**

- **Local only:** `bash start-all.sh` (frontend + backend, Ctrl+C to stop)
- **Push + deploy only:** `bash deploy.sh`

**Stop local servers:**

```bash
lsof -ti:8000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```
