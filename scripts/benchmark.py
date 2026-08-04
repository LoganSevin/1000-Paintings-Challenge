import json, base64, time
from io import BytesIO
from pathlib import Path
import httpx
from PIL import Image

auth = json.loads(Path.home().joinpath(".grok/auth.json").read_text(encoding="utf-8"))
key = next(v["key"] for v in auth.values() if isinstance(v, dict) and v.get("key"))
path = Path(__file__).resolve().parent.parent.parent / "1000 Paintings Challenge" / "200.jpg"
raw = path.read_bytes()
img = Image.open(BytesIO(raw))
img.thumbnail((512, 512))
buf = BytesIO()
img.save(buf, format="JPEG", quality=82)
small = buf.getvalue()
print(f"orig {len(raw)} -> small {len(small)}")

prompt = (
    'Return JSON only: {"title":"x","description":"one sentence",'
    '"style":"abstract","medium":"acrylic","mood":"calm",'
    '"tags":["a"],"colors":["pink"]}'
)

for model in ["grok-4.20-0309-non-reasoning", "grok-4.3"]:
    payload = {
        "model": model,
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_image",
                 "image_url": "data:image/jpeg;base64," + base64.standard_b64encode(small).decode(),
                 "detail": "low"},
                {"type": "input_text", "text": prompt},
            ],
        }],
        "store": False,
    }
    t0 = time.time()
    r = httpx.post(
        "https://api.x.ai/v1/responses",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    print(model, r.status_code, f"{time.time()-t0:.1f}s")
    if r.status_code != 200:
        print(r.text[:200])