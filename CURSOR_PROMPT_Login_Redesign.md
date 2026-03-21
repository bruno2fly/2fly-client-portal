# CURSOR PROMPT: Client Login Page Redesign

> **CRITICAL**: This project uses **vanilla HTML/CSS/JS** — NOT React/Next.js/Tailwind.
> The login page is a single file: `public/login.html`
> Read `DEV-AGENT-GUIDE.md` before making changes.

---

## Section 1: UX Structure

### Current Problems
- Logo image (`images/logo.png`) is broken — path doesn't exist, should use `/icons/icon-192.png`
- Purple gradient background feels generic — doesn't match the dark navy (#0B0F14) brand
- No "Forgot password?" link
- No loading state on the Sign In button
- No password visibility toggle
- Error message auto-hides after 5 seconds which can be missed
- No trust/security messaging
- "Contact your agency" footer gives no actionable path
- No visual feedback when form is submitting
- Client ID field has no helper text explaining what a "Client ID" is

### Improved Structure (top to bottom)
1. **Full-screen dark background** (#0B0F14) matching the app's theme color
2. **Centered card** (white, rounded, subtle shadow)
3. **Logo** — use `/icons/icon-192.png` (the new 2FlyFlow dark logo), displayed at 72px with rounded corners
4. **Heading**: "Welcome back" (lowercase, warm)
5. **Subheading**: "Sign in to view your content, approvals, and updates"
6. **Error banner** (red, with icon, persistent until dismissed or form resubmitted)
7. **Client ID field** with helper text: "The ID your agency gave you"
8. **Password field** with show/hide toggle icon
9. **"Forgot password?" link** (right-aligned above submit button)
10. **Submit button** with loading spinner state: "Sign In" → "Signing in..."
11. **Trust line**: small lock icon + "Your data is encrypted and secure"
12. **Footer**: "Need access? Ask your agency team to invite you."
13. **Staff login link**: subtle "Agency staff? Sign in here →" linking to `/staff-login`

---

## Section 2: Final Microcopy

### Heading Area
- **Heading**: `Welcome back`
- **Subheading**: `Sign in to view your content, approvals, and updates`

### Field Labels & Helpers
- **Client ID label**: `Client ID`
- **Client ID placeholder**: `e.g. ardanspa`
- **Client ID helper**: `The ID your agency gave you`
- **Password label**: `Password`
- **Password placeholder**: `Enter your password`

### Error Messages
- **Empty fields**: `Please enter your client ID and password`
- **Invalid credentials**: `Invalid client ID or password. Please try again.`
- **Server unreachable**: `Unable to reach server. Check your connection and try again.`

### Links
- **Forgot password**: `Forgot password?`
- **No account**: `Need access? Ask your agency team to invite you.`
- **Staff login**: `Agency staff? Sign in here →`

### Trust/Security
- **Trust line**: `🔒 Your data is encrypted and secure`

### Button States
- **Default**: `Sign In`
- **Loading**: `Signing in...` (with spinner)
- **Disabled**: grayed out while submitting

---

## Section 3: Cursor Prompt (Copy-Paste Ready)

```
IMPORTANT: This is a vanilla HTML/CSS/JS project. NOT React, NOT Next.js, NOT Tailwind.
The login page is a single self-contained file: public/login.html
It contains HTML + inline <style> + inline <script>.
Do NOT create React components, JSX, or import statements.

TASK: Refactor public/login.html to match this improved UX design.
Keep ALL existing JavaScript logic (API calls, session storage, redirect).
Only change the HTML structure, CSS, and add the new UI elements.

DESIGN SPEC:

1. BACKGROUND
   - Change body background from purple gradient to solid dark: #0B0F14
   - Add subtle noise or radial glow: radial-gradient(ellipse at top, #1a1f3d 0%, #0B0F14 60%)

2. CARD
   - Keep white card centered
   - Max-width: 420px
   - Padding: 40px 36px
   - Border-radius: 20px
   - Shadow: 0 25px 60px rgba(0,0,0,0.5)

3. LOGO
   - Replace broken <img src="images/logo.png"> with <img src="/icons/icon-192.png" alt="2FlyFlow">
   - Size: 72px x 72px
   - Border-radius: 16px
   - Add subtle box-shadow: 0 4px 16px rgba(0,0,0,0.2)

4. HEADING
   - H1: "Welcome back" (font-size: 26px, font-weight: 700, color: #0f172a)
   - Subtitle: "Sign in to view your content, approvals, and updates"
     (font-size: 14px, color: #64748b, margin-top: 6px)

5. ERROR BANNER
   - Keep existing error div but improve:
   - Add ⚠ icon before text
   - Background: #fef2f2, border-left: 3px solid #dc2626
   - Don't auto-hide — let it stay until next form submission
   - Add aria-live="polite" for accessibility

6. CLIENT ID FIELD
   - Label: "Client ID" (font-size: 13px, font-weight: 600, color: #374151)
   - Input placeholder: "e.g. ardanspa"
   - Below input, add helper text: <span class="form-helper">The ID your agency gave you</span>
   - Helper style: font-size: 12px, color: #94a3b8, margin-top: 4px
   - Focus state: border-color: #1e40af (brand blue, not purple)
   - Error state: border-color: #dc2626, background: #fef2f2

7. PASSWORD FIELD
   - Label: "Password"
   - Add a show/hide toggle button inside the input (eye icon):
     <button type="button" class="password-toggle" onclick="togglePassword()">
       👁 (or SVG eye icon)
     </button>
   - Position: absolute right:12px, top:50%, transform: translateY(-50%)
   - Wrap input in position:relative div
   - Toggle between type="password" and type="text"

8. FORGOT PASSWORD LINK
   - Add between password field and submit button:
     <div style="text-align:right;margin-bottom:16px;">
       <a href="/forgot-password" class="forgot-link">Forgot password?</a>
     </div>
   - Style: font-size: 13px, color: #1e40af, text-decoration: none
   - Hover: text-decoration: underline

9. SUBMIT BUTTON
   - Change gradient from purple to brand blue:
     background: linear-gradient(180deg, #1e40af, #1a3690)
   - Hover: background: linear-gradient(180deg, #1a3690, #152e7a)
   - Add loading state:
     When form submits, change button text to "Signing in..."
     Add a small CSS spinner before the text
     Set button disabled while loading
     Re-enable on error

10. TRUST LINE
    - Below the button, add:
      <div class="trust-line">🔒 Your data is encrypted and secure</div>
    - Style: text-align: center, font-size: 12px, color: #94a3b8, margin-top: 16px

11. FOOTER
    - Change text to: "Need access? Ask your agency team to invite you."
    - Add below: <a href="/staff-login" class="staff-link">Agency staff? Sign in here →</a>
    - Staff link style: display: block, margin-top: 8px, color: #1e40af,
      font-size: 12px, text-decoration: none

12. ACCESSIBILITY
    - All inputs must have associated <label for="...">
    - Error banner: aria-live="polite", role="alert"
    - Submit button: aria-label="Sign in to your account"
    - Form: autocomplete attributes already present (keep them)
    - Focus-visible outline on all interactive elements

13. RESPONSIVE
    - On screens < 480px:
      - Card padding: 28px 20px
      - Heading font-size: 22px
      - Remove card border-radius (full-bleed on small phones) — or keep 16px with margin:12px

14. LOADING STATE JAVASCRIPT
    Add to the existing form submit handler:
    ```javascript
    // Before the fetch call:
    const submitBtn = document.querySelector('.btn-primary');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-spinner"></span> Signing in...';

    // After success or error:
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
    ```

    Add CSS for spinner:
    ```css
    .btn-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    ```

15. PASSWORD TOGGLE JAVASCRIPT
    ```javascript
    function togglePassword() {
      const input = document.getElementById('password');
      const btn = document.querySelector('.password-toggle');
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁';
      }
    }
    ```

COLOR SYSTEM (use these instead of the current purple):
- Primary: #1e40af (blue)
- Primary hover: #1a3690
- Primary light: #dbeafe
- Background: #0B0F14
- Card: #ffffff
- Text: #0f172a
- Text secondary: #64748b
- Text muted: #94a3b8
- Border: #e2e8f0
- Error: #dc2626
- Error bg: #fef2f2
- Success: #059669

PRESERVE:
- All existing JS logic (API_BASE, login function, session handling, redirect)
- The service worker registration at the bottom
- The localStorage session key: "2fly_client_session"
- The auto-redirect if session exists

DO NOT:
- Create React components
- Use Tailwind classes
- Use ES modules or imports
- Split into multiple files
- Remove the existing login/auth logic
```

---

## Quick Reference: File to Edit

| File | What |
|------|------|
| `public/login.html` | The entire login page (HTML + CSS + JS in one file) |

No server changes needed. No build step needed. Just edit the HTML file and push.
After pushing to `main`, Vercel auto-deploys.
