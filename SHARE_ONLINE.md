# Share online with Generate working

**Start here for full participation:** `SHARE_AND_PARTICIPATE.md` (one link, visitors generate + share spell combos).

---

# Netlify + Render (split hosting)

**Netlify** = your paintings and website (fast, free).  
It **cannot** run `start_server.bat` — that only runs on your PC.

To let visitors **generate stasis images**, add a free **Render** API (15 minutes).

---

## Part 1 — Netlify (you may already have this)

1. Run `deploy_live.bat`
2. Drag the `gallery` folder to [Netlify Drop](https://app.netlify.com/drop)
3. Save your link, e.g. `https://my-paintings.netlify.app`

Visitors can browse and use timelapse. Generate will not work until Part 2.

---

## Part 2 — Render API (enables Generate)

### A. Put the gallery on GitHub (one time)

1. Create a free account at [github.com](https://github.com)
2. New repository (e.g. `1000-paintings-gallery`)
3. Upload the **contents** of your `gallery` folder (include `paintings/`, `data/`, `scripts/`, `js/`, `index.html`, `requirements.txt`)

Large upload is normal (~90 MB of JPGs).

### B. Create Render service

1. [dashboard.render.com](https://dashboard.render.com) → sign up free  
2. **New +** → **Web Service** → connect your GitHub repo  
3. Settings:
   - **Name:** `paintings-spellforge-api` (anything)
   - **Root directory:** leave blank if repo root *is* the gallery folder
   - **Runtime:** Python
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `python scripts/app_server.py`
4. **Environment variables** (Environment tab):

   | Key | Value |
   |-----|--------|
   | `XAI_API_KEY` | your xAI API key (same as local) |
   | `PUBLIC_URL` | your Render URL, e.g. `https://paintings-spellforge-api.onrender.com` |

5. **Create Web Service** — wait until status is **Live** (first deploy ~5 min)

6. Open `https://YOUR-SERVICE.onrender.com/api/health` — you should see `"api_version": 3`

### C. Connect Netlify to Render

1. On your PC, open `gallery/js/spellforge-config.js`
2. Change the line to (use **your** Render URL, no trailing slash):

   ```javascript
   window.SPELLFORGE_API_BASE = "https://paintings-spellforge-api.onrender.com";
   ```

3. Run `deploy_live.bat` and **drag the gallery folder to Netlify again** (update deploy)

4. Open your Netlify link → Spellforge → **Generate** should work after Render wakes up (~30s if it was asleep)

---

## Who runs what?

| Person | Does what |
|--------|-----------|
| **You** | `start_server.bat` on your PC when testing locally |
| **Visitors** | Only open your Netlify link — never install anything |
| **Render** | Runs AI in the cloud (uses your `XAI_API_KEY`) |

Each generate on the live site uses your API credits, same as local.

---

## Easier alternative: one link on Render only

Skip Netlify. Deploy the same repo to Render (steps B above) and share:

`https://YOUR-SERVICE.onrender.com/#spellforge`

That one URL serves paintings + AI. Slower cold start on free tier, but simpler.

---

## Troubleshooting

- **Still says start_server.bat** — hard refresh (Ctrl+Shift+R); redeploy Netlify after editing `spellforge-config.js`
- **Generate times out** — open Render URL in a tab first to wake the server, then try Generate
- **401 / API error** — check `XAI_API_KEY` on Render