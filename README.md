# 2Fly Client Portal - Content Library

## Setup

1. Install dependencies:
```bash
npm install react react-dom react-router-dom
npm install -D @types/react @types/react-dom typescript vite @vitejs/plugin-react tailwindcss postcss autoprefixer
```

2. Initialize Tailwind CSS:
```bash
npx tailwindcss init -p
```

3. Update `tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

4. Add to your `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

5. Import CSS in your main entry file (e.g., `main.tsx`):
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css' // This imports tokens.css automatically

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

6. Add Tailwind directives to `src/index.css` (if not already present):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Features

- **Content Library** at `/content` route
- Drag & drop file uploads
- Grid and list view modes
- Filtering by type, status, tags, and search
- Asset approval workflow
- Comments and collaboration
- Bulk actions
- Responsive design

## Data Storage

Uses localStorage with key: `content_library_v1_{clientId}`

To reset: `localStorage.removeItem('content_library_v1_casa-nova')`

## Backend Migration

See comments in `/src/pages/ContentLibrary.tsx` and `/src/lib/contentStore.ts` for migration notes to:
- S3/Cloudflare R2 for file storage
- Database for metadata
- API endpoints for CRUD operations
- Authentication/authorization

## Development

```bash
npm run dev
```

Visit `http://localhost:5173/content` to see the Content Library.

