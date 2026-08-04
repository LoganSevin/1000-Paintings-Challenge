# 1000 Paintings Challenge — Gallery

**Author & owner of all art: Logan Sevin**

Browse the 1000 Paintings Challenge. Every painting and studio work is authored and owned by **Logan Sevin**. Studio software may assist the pipeline; it is never the author. See `AUTHORSHIP.md` and `data/artist-identity.json`.

## Quick start

```powershell
cd "C:\Users\wiima\OneDrive\Desktop\1000 Paintings Challenge\gallery"

# 1. Build manifest
python scripts/build_manifest.py

# 2. Analyze paintings (uses ~/.grok auth or XAI_API_KEY)
python scripts/analyze.py

# 3. Start app server (gallery + Spellforge video)
python scripts/app_server.py
```

Open **http://localhost:8765/** — **Gallery** tab to browse; **Spellforge** tab to cast videos from your paintings.

## Analysis options

```powershell
# Analyze a range (for testing)
python scripts/analyze.py --start 1 --end 50

# Resume anytime — skips already-analyzed entries
python scripts/analyze.py

# Adjust concurrency
python scripts/analyze.py --workers 6 --model grok-4.3
```

Progress is saved to `data/analyses.json` every 5 paintings.

## Requirements

- Python 3.10+
- `pip install -r requirements.txt`
- xAI API access (`XAI_API_KEY` or Grok CLI auth at `~/.grok/auth.json`)