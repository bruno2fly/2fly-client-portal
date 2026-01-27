# Setup, then commit and push data files

## 1. Run setup

**Option A – `setup-cli.js` (plain Node, no tsx):**

```bash
cd ~/Desktop/2Flyflow.com/2fly-client-portal-main/server
node setup-cli.js "2Fly Agency" "owner@2flyflow.com" "Agency Owner" --password "Owner123!"
```

Or: `npm run setup:cli -- "2Fly Agency" "owner@2flyflow.com" "Agency Owner" --password "Owner123!"`

**Option B – TypeScript setup (uses tsx):**

```bash
cd ~/Desktop/2Flyflow.com/2fly-client-portal-main/server
npm run setup -- "2Fly Agency" "owner@2flyflow.com" "Agency Owner" --password "Owner123!"
```

## 2. Commit and push generated data files

```bash
cd ~/Desktop/2Flyflow.com/2fly-client-portal-main
git add .gitignore server/data/ server/setup-cli.js
git commit -m "Setup: agency + owner, add server data and setup-cli"
git push origin main
```

---

- **`setup-cli.js`**: Plain Node script (no tsx). Use if `npm run setup` fails.
- **`server/data/`**: No longer gitignored so it can be committed.
- **Owner login**: `owner@2flyflow.com` or `owner` / `Owner123!`
