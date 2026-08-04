# Deploy your gallery live

Your **Gallery** is a static site (1000 images + `data/analyses.json`). Host it free on Netlify in a few minutes.

**Spellforge** on the live URL works offline (spellbook, fusion text, timelapse from equipped paintings). **AI blend** and **stasis image generation** need `app_server.py` — either run locally, or host the API on [Render](https://render.com) (see below).

---

## Quick live deploy (Netlify — recommended)

### First time

1. Double-click **`deploy_live.bat`** in the `gallery` folder  
   (or run `python scripts/prepare_deploy.py` yourself).

2. When the browser opens [Netlify Drop](https://app.netlify.com/drop), **drag the entire `gallery` folder** onto the page.

3. Wait for upload (~90 MB, 2–5 minutes).

4. Netlify gives you a URL, e.g. `https://your-site.netlify.app`

5. Share:
   - Gallery: `https://your-site.netlify.app/`
   - Spellforge: `https://your-site.netlify.app/#spellforge`

### Update the live site

1. Edit files locally (or re-run analysis).
2. Run **`deploy_live.bat`** again (refreshes paintings if needed).
3. Drag the **`gallery` folder** onto Netlify Drop again (same site → **Deploys** tab may also allow drag to existing site).

Or connect the folder to Netlify via Git for one-click updates later.

---

## What works on the live URL (no server)

| Feature | Live (Netlify) |
|--------|----------------|
| Gallery grid, search, lightbox | Yes |
| Spellbook shuffle, pager | Yes |
| Equip spells, local fusion text | Yes |
| Buzz words + timelapse (canvas) | Yes |
| AI blend descriptions | No — needs API |
| Generate stasis image | No — needs API |

Visitors see a banner in Spellforge if the API is not configured.

---

## Full Spellforge AI on the internet (optional)

Host **`app_server.py`** on Render (free tier):

1. Push the `gallery` folder to a GitHub repo (include `paintings/`, `data/`, `scripts/`, `requirements.txt`).

2. [Render Dashboard](https://dashboard.render.com) → **New → Web Service** → connect the repo.

3. Settings:
   - **Root directory:** `gallery` (if repo root is parent) or `.` if repo is the gallery folder
   - **Build:** `pip install -r requirements.txt`
   - **Start:** `python scripts/app_server.py`
   - **Environment:** add `XAI_API_KEY` (your xAI key)

4. Render gives a URL like `https://paintings-gallery-api.onrender.com` — that serves **both** the site and APIs.

5. Optional: point a custom domain at Render, or keep Netlify for static and set API base (advanced — ask if you need split hosting).

`render.yaml` in this folder is a starter blueprint for Render.

---

## Other hosts

### Vercel (static)

```powershell
cd "C:\Users\wiima\OneDrive\Desktop\1000 Paintings Challenge\gallery"
vercel
```

### GitHub Pages

Push `gallery` contents to a repo; enable Pages on `main` branch. Ensure `paintings/` is committed (large — Git LFS optional).

---

## Local vs live

| | Local `start_server.bat` | Live Netlify |
|--|--------------------------|--------------|
| URL | http://localhost:8765 | https://yoursite.netlify.app |
| Gallery | Yes | Yes |
| Spellforge AI | Yes (API key on your PC) | Browse/fusion only unless Render API |

---

## Custom domain

- **Netlify:** Site configuration → Domain management → Add domain → follow DNS steps.
- **Render:** Settings → Custom Domains.

---

## Prepare command (manual)

```powershell
python scripts/prepare_deploy.py
```

Ensures all 1000 JPGs are in `gallery/paintings/` before upload.