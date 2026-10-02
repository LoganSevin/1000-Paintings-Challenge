import assert from "node:assert/strict";
import test from "node:test";
import { buildCloudflarePrompt, buildStasisVisionPrompt } from "../../netlify/functions/_lib.mjs";

test("Spellforge stasis prompt explicitly preserves all three identities", () => {
  const stasis = [
    "THREE IDENTITIES IN ONE PAINTING.",
    "SPELL I — Courtyard (#957)",
    "A sunlit Mediterranean courtyard with blue shutters.",
    "SPELL II — Peony (#579)",
    "A vibrant peony in full bloom.",
    "SPELL III — Coaster (#392)",
    "A coastal roller coaster winding above the sea.",
  ].join("\n");

  const prompt = buildStasisVisionPrompt(stasis, [], "16:9");

  assert.match(prompt, /Spellforge three-spell fusion/);
  assert.match(prompt, /Spell I, Spell II, and Spell III/);
  assert.match(prompt, /equally prominent, immediately recognizable/);
  assert.match(prompt, /sunlit Mediterranean courtyard/);
  assert.match(prompt, /vibrant peony/);
  assert.match(prompt, /coastal roller coaster/);
});

test("non-Spellforge stasis prompts keep the general framing", () => {
  const prompt = buildStasisVisionPrompt("A quiet field at dawn.", [], "16:9");

  assert.doesNotMatch(prompt, /Spellforge three-spell fusion/);
  assert.match(prompt, /A quiet field at dawn/);
});

test("a signed Spellforge prompt keeps Spell III and the signature under the cap", () => {
  const filler = "Brushwork continues across the courtyard wall. ".repeat(160);
  const stasis = [
    "THREE IDENTITIES IN ONE PAINTING.",
    "SPELL I — Courtyard (#957)",
    filler,
    "SPELL II — Peony (#579)",
    "A vibrant peony in full bloom.",
    "SPELL III — Coaster (#392)",
    "A coastal roller coaster winding above the sea.",
    "",
    'OUTPUT ASPECT 16:9 wide — this ratio is mandatory, not 1:1 unless the control is 1:1.',
    'IN-CANVAS SIGNATURE (mandatory, small, painterly, lower corner): write exactly "Logan Sevin · 2 October 2026  05:11:00 PDT".',
  ].join("\n");

  const prompt = buildStasisVisionPrompt(stasis, [], "16:9", {
    signature: "Logan Sevin · 2 October 2026  05:11:00 PDT",
  });

  assert.ok(prompt.length <= 7992);
  assert.match(prompt, /^16:9 wide canvas/);
  assert.match(prompt, /coastal roller coaster/);
  assert.match(prompt, /Logan Sevin · 2 October 2026/);
  assert.doesNotMatch(prompt, /\blandscape\b/i);
});

test("Cloudflare fallback does not ask for a landscape or forbid the signature", () => {
  const stasis = [
    "THREE IDENTITIES IN ONE PAINTING.",
    "SPELL I — Courtyard (#957)",
    "A sunlit courtyard with blue shutters.",
    "SPELL II — Peony (#579)",
    "A vibrant peony in full bloom.",
    "SPELL III — Coaster (#392)",
    "A coastal roller coaster winding above the sea.",
  ].join("\n");
  const prompt = buildCloudflarePrompt(stasis, [], "16:9", {
    signature: "Logan Sevin · 2 October 2026  05:11:00 PDT",
  });

  assert.match(prompt, /courtyard/i);
  assert.match(prompt, /peony/i);
  assert.match(prompt, /roller coaster/i);
  assert.match(prompt, /Logan Sevin/);
  assert.match(prompt, /not a square/i);
  assert.doesNotMatch(prompt, /\blandscape\b/i);
  assert.doesNotMatch(prompt, /no signature/i);
});
