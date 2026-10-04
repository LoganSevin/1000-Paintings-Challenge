import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCloudflarePrompt,
  buildStasisVisionPrompt,
  dropModerationTriggerWords,
  moderationStrikeFromImageResponse,
  shouldTryGrokLogin,
} from "../../netlify/functions/_lib.mjs";

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
  const courtyard = prompt.indexOf("sunlit Mediterranean courtyard");
  const peony = prompt.indexOf("vibrant peony");
  const coaster = prompt.indexOf("coastal roller coaster");
  const outcome = prompt.indexOf("Spellforge three-spell fusion");

  assert.match(prompt, /^16:9 wide canvas/);
  assert.match(prompt, /Spellforge three-spell fusion/);
  assert.match(prompt, /Spell I, Spell II, and Spell III/);
  assert.match(prompt, /equally prominent, immediately recognizable/);
  assert.ok(courtyard >= 0 && peony > courtyard && coaster > peony);
  assert.ok(outcome > coaster);
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

  const coaster = prompt.indexOf("coastal roller coaster");
  const outcome = prompt.indexOf("Spellforge three-spell fusion");
  const signature = prompt.indexOf("Logan Sevin · 2 October 2026");

  assert.ok(prompt.length <= 7992);
  assert.match(prompt, /^16:9 wide canvas/);
  assert.ok(coaster >= 0 && outcome > coaster && signature > outcome);
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

  const coaster = prompt.toLowerCase().indexOf("roller coaster");
  const outcome = prompt.toLowerCase().indexOf("seamless scene");

  assert.match(prompt, /courtyard/i);
  assert.match(prompt, /peony/i);
  assert.match(prompt, /roller coaster/i);
  assert.ok(coaster >= 0 && outcome > coaster);
  assert.match(prompt, /Logan Sevin/);
  assert.match(prompt, /not a square/i);
  assert.doesNotMatch(prompt, /\blandscape\b/i);
  assert.doesNotMatch(prompt, /no signature/i);
});

test("a moderation strike returns the prompt with the trigger word removed", () => {
  const prompt = "A figure stands at an anvil with blood on the ropes in a quiet room.";
  const strike = moderationStrikeFromImageResponse(
    {
      data: [
        {
          url: "https://example.test/moderation-note.jpg",
          respect_moderation: false,
        },
      ],
    },
    prompt
  );

  assert.equal(strike.moderated, true);
  assert.deepEqual(strike.dropped, ["blood"]);
  assert.match(strike.prompt, /quiet room/);
  assert.doesNotMatch(strike.prompt, /\bblood\b/i);
});

test("a passed image is not treated as a moderation strike", () => {
  assert.equal(
    moderationStrikeFromImageResponse(
      { data: [{ url: "https://example.test/art.jpg", respect_moderation: true }] },
      "A quiet room."
    ),
    null
  );
  const kept = dropModerationTriggerWords("A quiet room with a halo.");
  assert.equal(kept.prompt, "A quiet room with a halo.");
  assert.deepEqual(kept.dropped, []);
  const listed = dropModerationTriggerWords("blood, halo");
  assert.equal(listed.prompt, "halo");
  assert.deepEqual(listed.dropped, ["blood"]);
});

test("a credit or rejected key is handed to the Grok login", () => {
  assert.equal(
    shouldTryGrokLogin(new Error("Your team has used all available credits or reached its monthly spending limit.")),
    true
  );
  assert.equal(shouldTryGrokLogin(new Error("Incorrect API key provided")), true);
  assert.equal(shouldTryGrokLogin(new Error("Prompt cannot be empty")), false);
});
