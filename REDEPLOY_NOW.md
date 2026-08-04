# Fix: Netlify shows "run start_server.bat" (wrong message)

Your live site is still serving an **old** `spellforge.js`.  
That file tells everyone to use localhost — even on https://1000-l7in.netlify.app.

**Visitors never run start_server.bat.** Only you deploy from your PC.

---

## Fix (one time)

### 1. On your PC

Double-click **`scripts\deploy_prod.bat`** in the `gallery` folder  
(or the older **`deploy_netlify_easy.bat`**).

Wait until it says **Live URL: https://1000-l7in.netlify.app**.

If Netlify says **credit usage exceeded**, the script still uploads a draft and publishes it to production when possible.

### 2. Hard refresh the live site

Open https://1000-l7in.netlify.app/#spellforge

Press **Ctrl+Shift+R** (or clear cache).

You should **not** see "start_server.bat" anymore.

### 3. Add API key (if Generate still fails)

[app.netlify.com](https://app.netlify.com) → **1000-l7in** → **Environment variables** → **`XAI_API_KEY`** → **Deploy site**

Test: https://1000-l7in.netlify.app/api/health → JSON, not "Page not found"

---

## On your PC only

`start_server.bat` → http://localhost:8765 — for you while building, not for the public link.