# Fix: "This site is missing the AI server upgrade"

Your link **https://1000-l7in.netlify.app** is live for **files only** (paintings, pages).

**Dragging the folder to Netlify Drop does NOT install Generate.**  
Netlify requires a **build deploy** to turn on the cloud API.

---

## Fix in 3 steps

### Easy way (do not use `npm install -g`)

Double-click **`deploy_netlify_easy.bat`** in the `gallery` folder.

It uses **`npx netlify`** (no global install). Use **Command Prompt** via the `.bat` file — not PowerShell if scripts are blocked.

### Manual way (Command Prompt)

```bat
cd /d "C:\Users\wiima\OneDrive\Desktop\1000 Paintings Challenge\gallery"
npm install
npx netlify login
npx netlify link
npx netlify deploy --prod --build
```

### No CLI at all

See **`NETLIFY_NO_CLI.md`** — connect **GitHub** on the Netlify website.

Wait until it says **Published**.

---

## Add your API key

1. [app.netlify.com](https://app.netlify.com) → site **1000-l7in**
2. **Site configuration** → **Environment variables**
3. Add **`XAI_API_KEY`** = your xAI key
4. **Deploys** → **Trigger deploy** → **Deploy site**  
   (or run `deploy_netlify_full.bat` again)

---

## Test

Open: https://1000-l7in.netlify.app/api/health

You should see JSON like:

```json
{"ok":true,"api_version":3,"stasis_vision":true,"api_configured":true}
```

If you see **Page not found**, the build deploy did not run — repeat step 3.

Then open https://1000-l7in.netlify.app/#spellforge → **Ctrl+Shift+R** → Generate.

---

## Alternative: GitHub + Netlify (no CLI)

1. Upload `gallery` to GitHub  
2. Netlify → **Add new site** → **Import from Git**  
3. Build command: `npm install`  
4. Publish directory: `.`  
5. Add `XAI_API_KEY` in environment variables  
6. Deploy