# Add XAI_API_KEY (last step — you are almost done)

If Spellforge says:

**"Add XAI_API_KEY on Netlify and redeploy"**

that is **not a crash**. It means the cloud API is installed and only needs your key.

---

## Do this on the Netlify website (3 minutes)

1. Open **[app.netlify.com](https://app.netlify.com)** and log in.

2. Click your site (**1000-l7in** or the name of your unpublished deploy).

3. Go to **Site configuration** (left sidebar) → **Environment variables**.

4. Click **Add a variable** → **Add a single variable**.

5. Fill in:

   | Field | What to enter |
   |-------|----------------|
   | **Key** | `XAI_API_KEY` (copy exactly, capitals matter) |
   | **Value** | Your xAI API key |

   **Where is the key?** Same one that works with `start_server.bat` on your PC.  
   Often from [console.x.ai](https://console.x.ai) or your Grok/xAI account API keys page.

6. **Secret** = yes is fine. **Scopes** = check all (Production, Deploy Previews, Branch deploys) so previews work too.

7. Click **Save**.

8. **Important — redeploy after saving:**
   - Left menu **Deploys**
   - **Trigger deploy** → **Deploy project** (or **Clear cache and deploy site**)

   Environment variables only apply to **new** deploys. Saving the key alone is not enough.

---

## Test

1. Open your site URL + `/api/health`  
   Example: `https://1000-l7in.netlify.app/api/health`

   Good:

   ```json
   {"ok":true,"api_version":3,"api_configured":true,...}
   ```

   Bad: **Page not found** → run `deploy_netlify_easy.bat` first (see `NETLIFY_FIX.md`).

2. Open **/#spellforge** → **Ctrl+Shift+R** → equip 2 spells → **Generate**.

---

## Unpublished / preview URL

If you use a **deploy preview** link (not the main `1000-l7in.netlify.app`):

- Still add `XAI_API_KEY` on the **same Netlify site**.
- Enable scopes for **Deploy previews**.
- Trigger a **new deploy** after adding the key.

---

## Visitors

After this works, friends only open your link. They never add a key or run `start_server.bat`.