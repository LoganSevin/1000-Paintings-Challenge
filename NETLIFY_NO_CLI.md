# Deploy without `npm install -g` (easier on Windows)

If these failed for you:

```
npm install -g netlify-cli
netlify login
netlify link
```

Use **one** of these instead.

---

## Option A — Double-click (recommended)

1. Open folder: `1000 Paintings Challenge\gallery`
2. Double-click **`deploy_netlify_easy.bat`**
3. Follow the prompts (login in browser, pick site **1000-l7in**)
4. On Netlify website add **`XAI_API_KEY`** → Deploy again

**Do not use PowerShell** if it says "running scripts is disabled". The `.bat` file uses Command Prompt.

---

## Option B — No Netlify CLI at all (GitHub + website)

### 1. GitHub

1. Go to [github.com/new](https://github.com/new)
2. Name: `1000-paintings-gallery` → Create repository
3. Click **uploading an existing file**
4. Drag **everything inside** your `gallery` folder (include `paintings`, `data`, `netlify`, `package.json`, `netlify.toml`)
5. Commit

### 2. Netlify connect Git

1. [app.netlify.com](https://app.netlify.com) → **Add new project** → **Import an existing project**
2. **GitHub** → authorize → pick `1000-paintings-gallery`
3. Build settings (important):

   | Setting | Value |
   |---------|--------|
   | Build command | `npm install` |
   | Publish directory | `.` |

4. **Environment variables** → add **`XAI_API_KEY`** (your xAI key)
5. **Deploy site**

If you already have **1000-l7in** from drag-and-drop:

- **Site configuration** → **Build & deploy** → **Link repository** (same settings as above)
- Or create new site from Git and use the new URL

### 3. Test

`https://YOUR-SITE.netlify.app/api/health` → JSON with `"api_version": 3`

---

## Option C — Manual commands (Command Prompt only)

Press **Win+R** → type `cmd` → Enter:

```bat
cd /d "C:\Users\wiima\OneDrive\Desktop\1000 Paintings Challenge\gallery"
npm install
npx netlify login
npx netlify link
npx netlify deploy --prod --build
```

Use **`npx netlify`** not `netlify` alone (no global install).

---

## Link with Site ID (if `netlify link` menu is confusing)

1. Netlify → site **1000-l7in** → **Site configuration** → **General** → copy **Site ID**
2. In Command Prompt:

```bat
cd /d "C:\Users\wiima\OneDrive\Desktop\1000 Paintings Challenge\gallery"
npx netlify link --id PASTE-SITE-ID-HERE
npx netlify deploy --prod --build
```

---

## After deploy works

Add **`XAI_API_KEY`** in Netlify environment variables if Generate still fails.

Test: https://1000-l7in.netlify.app/api/health