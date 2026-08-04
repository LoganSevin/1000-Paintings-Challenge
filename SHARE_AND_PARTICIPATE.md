# Share your gallery — visitors play the full Spellforge

You want what works on your PC (browse, equip, fuse, generate, timelapse) on a link anyone can open.  
Visitors **do not** run `start_server.bat`. They use your link in a browser.

---

## Best setup: one link (Render)

One URL does everything — easiest for participation.

### 1. Upload to GitHub (one time)

1. [github.com](https://github.com) → new repository  
2. Upload everything inside your **`gallery`** folder (`paintings/`, `data/`, `scripts/`, `js/`, `index.html`, etc.)

### 2. Deploy on Render (free)

1. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service** → your repo  
2. **Build:** `pip install -r requirements.txt`  
3. **Start:** `python scripts/app_server.py`  
4. **Environment variables:**

   | Name | Value |
   |------|--------|
   | `XAI_API_KEY` | Your xAI key (same as local) |
   | `PUBLIC_URL` | `https://YOUR-APP-NAME.onrender.com` (your real Render URL) |

5. Wait until **Live**

6. Test: open `https://YOUR-APP-NAME.onrender.com/api/health` → should show `"api_version": 3`

### 3. Share with people

Send:

- **Gallery:** `https://YOUR-APP-NAME.onrender.com/`  
- **Spellforge:** `https://YOUR-APP-NAME.onrender.com/#spellforge`

They can:

- Browse all 1000 paintings  
- Equip Spell I / II / III  
- See fused stasis text and buzz words  
- **Generate stasis vision** (same as you)  
- Watch the timelapse  
- Click **Share spell link** to send friends their exact painting combo  

Their equipped spells **save in their browser** when they come back.

**Note:** Free Render sleeps when quiet — first visit may take ~30 seconds to wake up. Open the link once before sharing.

**Note:** Each generate uses **your** API key/credits (like running it locally).

---

## Optional: Netlify + Render (two parts)

- **Netlify** = fast painting hosting (you may already have this)  
- **Render** = AI only  

See `SHARE_ONLINE.md` for connecting them via `js/spellforge-config.js`.

---

## You vs visitors

| | You (building) | Visitors (participating) |
|--|----------------|---------------------------|
| Local test | `start_server.bat` → localhost | — |
| Public link | Same Render URL works for you too | Open your link, no install |
| Generate | Works | Works (via your Render API key) |
| Share a spell build | **Share spell link** button | Opens link with `?spells=501,241` loaded |

---

## Share a spell combo (participation)

1. Equip 2–3 paintings  
2. Click **Share spell link**  
3. Send the copied URL (e.g. `https://yoursite.onrender.com/?spells=501,241,199#spellforge`)  
4. Friend opens it → your paintings are already in their slots → they can fuse, generate, and remix  

---

## Still test on your PC?

Keep using **`start_server.bat`** — nothing changes locally.  
The live link is an extra copy of the same experience for everyone else.

---

## Quick checklist

- [ ] GitHub has full `gallery` folder  
- [ ] Render service **Live** with `XAI_API_KEY` + `PUBLIC_URL`  
- [ ] `/api/health` shows version 3  
- [ ] You tried Generate on the live URL  
- [ ] You shared `#spellforge` with friends