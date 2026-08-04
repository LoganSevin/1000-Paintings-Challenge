# Use WOMBO Dream instead of xAI for Generate

**Generate** paints a **new** image from your fused spell text. That step needs a paid image API — either xAI or **WOMBO Dream** (dream.ai).

Your **1000 paintings** are always yours (gallery + spellbook). No API is used to show them.

---

## Nothing was “taken away” online

Local (`start_server.bat`) and Netlify both used **xAI** for Generate.  
You can switch **both** to WOMBO with the settings below.

---

## 1. Get a WOMBO Dream API key

1. Sign up: https://api.dream.ai/signup  
2. Copy your API key (Dream / WOMBO API key).

---

## 2. On Netlify (public link)

**Site configuration** → **Environment variables** → add:

| Key | Value |
|-----|--------|
| `WOMBO_DREAM_API_KEY` | your Dream API key |
| `SPELLFORGE_IMAGE_PROVIDER` | `wombo` |

Optional: remove or ignore `XAI_API_KEY` if you only want WOMBO.

**Deploys** → **Trigger deploy** → **Deploy project**

Test: https://1000-l7in.netlify.app/api/health  

Should show:

```json
"image_provider": "wombo",
"api_configured": true
```

---

## 3. On your PC (local)

Before running `start_server.bat`, in Command Prompt:

```bat
set WOMBO_DREAM_API_KEY=your-key-here
set SPELLFORGE_IMAGE_PROVIDER=wombo
start_server.bat
```

Or set those in Windows **Environment variables** for your user.

---

## Notes

- WOMBO prompts are limited to **100 characters** (the server shortens your stasis + buzz words).
- **AI blend** (smarter fused text) still uses xAI if `XAI_API_KEY` is set; otherwise fusion uses your local `analyses.json` text (works without xAI).
- WOMBO also needs **credits** on your Dream account (like xAI).

Optional env vars:

| Key | Default | Meaning |
|-----|---------|---------|
| `WOMBO_STYLE_ID` | `1` | Dream style number |
| `WOMBO_WIDTH` | `1280` | Image width |
| `WOMBO_HEIGHT` | `720` | Image height |