# Reference codes

An 8-character code is the reference point for one solution. Decisions look up the code and read the outcome that already succeeded.

## The space

The alphabet is `0–9`, then `a–z`.

- Start: `00000000`
- End: `zzzzzzzz`
- Size: 36⁸ = 2,821,109,907,456 codes

`z` is the last letter. The space collects data, so it runs through `z`.

## Color reading

A code whose every character is in `0–9` or `a–f` is also a color with alpha.

- Characters 1–6 are red, green, and blue.
- Characters 7–8 are alpha.

`3c87f1e7` reads as `#3c87f1` at alpha `e7` (231/255).

A code that uses `g–z` stays a data reference. It does not collapse into a color. `ffffffff` is the last color-with-alpha. `zzzzzzzz` is the last code in the whole space.

## Occupied

| Code | Outcome |
| --- | --- |
| `1b9cfd4f` | Cameos opens with no key wall. `#1b9cfd` at alpha `4f`. |
| `3c87f1e7` | Grok generates a new Cameos short from the uploaded reference, in the Eve voice. `#3c87f1` at alpha `e7`. |
| `c9b223f5` | Descriptions for 160 generated stills, #5920–#6079. `#c9b223` at alpha `f5`. |
| `d41ddde2` | Descriptions for 159 generated stills, #5921–#6079. `#d41ddd` at alpha `e2`. |
| `7613cc91` | Description for generated still #5920, Surreal Cosmic Sorceress. `#7613cc` at alpha `91`. |
| `e5a8e7d0` | Descriptions for 133 generated stills, from #5920 to #6058. `#e5a8e7` at alpha `d0`. |
| `88437714` | Descriptions for 233 generated stills, from #5656 to #5919. `#884377` at alpha `14`. |

The statement for `3c87f1e7` is [CAMEOS.md](CAMEOS.md). Each description publish files its commit code here. The Codes tab keeps that publish’s still titles and descriptions. The lookup tab is `#codes`.
