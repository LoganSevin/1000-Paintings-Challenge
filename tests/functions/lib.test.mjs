import assert from "node:assert/strict";
import test from "node:test";
import { buildStasisVisionPrompt } from "../../netlify/functions/_lib.mjs";

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
