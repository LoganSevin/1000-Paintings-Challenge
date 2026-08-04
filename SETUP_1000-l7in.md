# Your live site: https://1000-l7in.netlify.app

Netlify hosts your paintings and the Spellforge page.  
**Generate** and **AI blend** need a small free API on Render, then one line in a config file.

Visitors always use: **https://1000-l7in.netlify.app/#spellforge**  
They never run `start_server.bat`.

---

## Step 1 — Update Netlify (required — not drag-and-drop)

On your PC:

1. Double-click **`deploy_netlify_easy.bat`** in the `gallery` folder (Command Prompt window — not PowerShell)  
2. Log in, link site **1000-l7in**, wait until **Published**  
3. Open https://1000-l7in.netlify.app/api/health — must show JSON, not “Page not found”  
4. Open https://1000-l7in.netlify.app/#spellforge and press **Ctrl+Shift+R**

**Do not use `deploy_live.bat` or Netlify Drop** for Spellforge — those skip the cloud API and often leave an old `spellforge.js` that tells visitors to run `start_server.bat`.

---

## Step 2 — Create Render API (one time, ~15 min)

### A. GitHub

Upload your whole **`gallery`** folder to a GitHub repo (if you have not already).

### B. Render

1. https://dashboard.render.com → **New +** → **Web Service** → connect the repo  
2. **Build command:** `pip install -r requirements.txt`  
3. **Start command:** `python scripts/app_server.py`  
4. **Environment variables:**

   | Key | Value |
   |-----|--------|
   | `XAI_API_KEY` | Your xAI API key |
   | `PUBLIC_URL` | Your Render URL after create, e.g. `https://1000-paintings-api.onrender.com` |

5. Click **Create** → wait until **Live**

6. Test in browser: `https://YOUR-RENDER-URL.onrender.com/api/health`  
   Must show: `"api_version": 3`

**Write your Render URL here:** _______________________________

---

## Step 3 — Connect Netlify to Render

1. Open `gallery/js/spellforge-config.js` on your PC  
2. Replace the empty line with **your** Render URL (no trailing slash):

   ```javascript
   window.SPELLFORGE_API_BASE = "https://YOUR-RENDER-URL.onrender.com";
   ```

3. Run **`deploy_live.bat`** again and upload to Netlify (same as Step 1)

4. Open https://1000-l7in.netlify.app/#spellforge → **Ctrl+Shift+R**

5. Green banner: **Live Spellforge** → equip 2 spells → **Generate** should work  
   (If Render was asleep, wait 30 seconds and try again)

---

## What friends can do on your link

| Feature | URL |
|---------|-----|
| Gallery | https://1000-l7in.netlify.app/ |
| Spellforge | https://1000-l7in.netlify.app/#spellforge |
| Your spell combo | Click **Share spell link** after equipping paintings |

---

## Checklist

- [ ] Netlify redeployed with latest `gallery` folder  
- [ ] Render service **Live** + health check OK  
- [ ] `spellforge-config.js` has Render URL  
- [ ] Netlify redeployed **after** config edit  
- [ ] Generate works on https://1000-l7in.netlify.app/#spellforge  

---

## You locally

Keep using **`start_server.bat`** for testing — leave `spellforge-config.js` with empty `""` or comment out the Render line when testing localhost.