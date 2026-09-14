# -*- coding: utf-8 -*-
"""Build a colorful daily still-drop HTML letter."""
from __future__ import annotations

IDS = [
    41, 119, 206, 331, 402, 477, 512, 640, 701, 788,
    819, 901, 944, 990, 1022, 1088, 1133, 1210, 1288, 1355,
    1419, 1472, 1533, 1611, 1684,
]
BASE = "https://1000-l7in.netlify.app/generated/{}.jpg"
GALLERY = "https://1000-l7in.netlify.app/"
GH = "https://github.com/LoganSevin/1000-Paintings-Challenge"
CASH5 = "https://cash.app/$Logan7in/5"
COLORS = ["#C45C26", "#D4A017", "#2A9D8F", "#E76F51", "#7B2D8E", "#1D3557", "#B5651D", "#9B2226"]
OUT = r"C:\Users\wiima\OneDrive\Desktop\1000 Paintings Challenge\gallery\data\newsletter-issue1-paid.html"


def cell(n: int, i: int) -> str:
    c = COLORS[i % len(COLORS)]
    url = BASE.format(n)
    return (
        f'<td width="20%" valign="top" style="padding:6px;">'
        f'<a href="{url}" style="text-decoration:none;">'
        f'<div style="border:1px solid {c};overflow:hidden;background:#111;">'
        f'<img src="{url}" alt="Generated #{n}" width="140" '
        f'style="display:block;width:100%;height:auto;border:0;"/>'
        f'<p style="margin:0;padding:7px 6px;font-family:Georgia,Times New Roman,serif;'
        f'font-size:11px;letter-spacing:0.08em;color:#f3ece3;text-align:center;background:{c};">#{n}</p>'
        f"</div></a></td>"
    )


def main() -> None:
    rows = []
    for r in range(0, 25, 5):
        chunk = "\n".join(cell(n, r + i) for i, n in enumerate(IDS[r : r + 5]))
        rows.append("<tr>\n" + chunk + "\n</tr>")
    grid = "\n".join(rows)
    html = f"""<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#120e0b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#120e0b;">
<tr><td align="center" style="padding:22px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#1a1612;overflow:hidden;border:1px solid #c45c26;">
<tr><td style="background:#1a1612;padding:28px 26px 16px;border-bottom:3px solid #c45c26;">
  <p style="margin:0;font-family:Georgia,Times New Roman,serif;font-size:12px;letter-spacing:0.22em;color:#d4a017;text-transform:uppercase;">1000 Paintings Challenge</p>
  <h1 style="margin:10px 0 0;font-family:Georgia,Times New Roman,serif;font-size:32px;line-height:1.15;color:#f3ece3;">Studio Dispatch</h1>
  <p style="margin:10px 0 0;font-family:Georgia,Times New Roman,serif;font-size:15px;color:#c9b8a4;">Daily stills · paid edition · 25 works</p>
</td></tr>
<tr><td style="background:#2a9d8f;padding:12px 26px;font-family:Georgia,Times New Roman,serif;font-size:14px;color:#0b1f1c;">
  Original work by Logan Sevin. Human-authored studio stills.
</td></tr>
<tr><td style="padding:22px 26px 8px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.55;color:#e8ddd0;">
  <p style="margin:0 0 12px;">Logan here. This is the daily cut from the studio. Free subscribers get 10 stills. The $5/month list gets 25 — this one.</p>
  <p style="margin:0;">Code, gallery, and the paid slot:</p>
</td></tr>
<tr><td style="padding:10px 26px 20px;">
  <a href="{GH}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;background:#7b2d8e;color:#f3ece3;font-family:Georgia,Times New Roman,serif;font-size:14px;text-decoration:none;border:1px solid #d4a017;">GitHub</a>
  <a href="{GALLERY}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;background:#c45c26;color:#f3ece3;font-family:Georgia,Times New Roman,serif;font-size:14px;text-decoration:none;border:1px solid #d4a017;">Gallery</a>
  <a href="{CASH5}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;background:#d4a017;color:#1a1612;font-family:Georgia,Times New Roman,serif;font-size:14px;text-decoration:none;">$5 / month · 25 stills</a>
</td></tr>
<tr><td style="padding:0 14px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{grid}</table>
</td></tr>
<tr><td style="padding:16px 26px 24px;font-family:Georgia,Times New Roman,serif;font-size:14px;line-height:1.5;color:#c9b8a4;">
  <p style="margin:0 0 8px;">Repo: <a href="{GH}" style="color:#d4a017;">github.com/LoganSevin/1000-Paintings-Challenge</a></p>
  <p style="margin:0 0 12px;">Pay: <a href="https://cash.app/$Logan7in" style="color:#e76f51;">Cash App $Logan7in</a> · X <a href="https://x.com/L7IN597" style="color:#2a9d8f;">@L7IN597</a></p>
  <p style="margin:0;padding:12px 14px;border-left:3px solid #c45c26;background:#221c18;color:#e8ddd0;">Subscribe: <a href="https://1000-l7in.netlify.app/subscribe" style="color:#d4a017;">1000-l7in.netlify.app/subscribe</a> — free list 10 stills a day, $5 a month for 25. Cash App note: <em>newsletter</em>.</p>
</td></tr>
<tr><td style="background:#0d0b09;padding:16px 26px;font-family:Georgia,Times New Roman,serif;font-size:13px;color:#8a7d70;">Logan Sevin · 1000 Paintings Challenge</td></tr>
</table>
</td></tr></table>
</body></html>
"""
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(OUT, len(html))


if __name__ == "__main__":
    main()
