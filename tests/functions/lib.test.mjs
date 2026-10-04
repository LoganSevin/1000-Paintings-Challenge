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
  const combo = prompt.indexOf("COMBINATION PIECE");
  const detail = prompt.indexOf("Conjoined detail");
  const courtyard = prompt.indexOf("sunlit Mediterranean courtyard");
  const peony = prompt.indexOf("vibrant peony");
  const coaster = prompt.indexOf("coastal roller coaster");
  const outcome = prompt.indexOf("Spellforge three-spell fusion");

  assert.match(prompt, /^16:9 wide canvas/);
  assert.match(prompt, /COMBINATION PIECE/);
  assert.match(prompt, /Do not paint Spell 1 by itself/);
  assert.match(prompt, /Conjoined detail/i);
  assert.match(prompt, /together with/i);
  assert.match(prompt, /Spellforge three-spell fusion/);
  assert.match(prompt, /one combination painting/);
  assert.match(prompt, /Spell 1, Spell 2, and Spell 3/);
  assert.doesNotMatch(prompt, /SPELL I —/);
  assert.equal((prompt.match(/COMBINATION PIECE/g) || []).length, 1);
  assert.ok(combo >= 0 && detail > combo);
  assert.ok(courtyard >= 0 && peony > courtyard && coaster > peony);
  assert.ok(outcome > coaster);
});

test("arabic spell numbers stay one conjoined paragraph", () => {
  const stasis = [
    "THREE IDENTITIES IN ONE PAINTING.",
    "SPELL 1 — Courtyard (#957)",
    "A sunlit Mediterranean courtyard with blue shutters.",
    "SPELL 2 — Peony (#579)",
    "A vibrant peony in full bloom.",
    "SPELL 3 — Coaster (#392)",
    "A coastal roller coaster winding above the sea.",
  ].join("\n");

  const prompt = buildStasisVisionPrompt(stasis, [], "16:9");
  const courtyard = prompt.indexOf("sunlit Mediterranean courtyard");
  const peony = prompt.indexOf("vibrant peony");
  const coaster = prompt.indexOf("coastal roller coaster");
  const outcome = prompt.indexOf("Spellforge three-spell fusion");

  assert.equal((prompt.match(/COMBINATION PIECE/g) || []).length, 1);
  assert.doesNotMatch(prompt, /SPELL 1 —/);
  assert.doesNotMatch(prompt, /Spell II/);
  assert.match(prompt, /together with/i);
  assert.match(prompt, /Conjoined detail/i);
  assert.match(prompt, /Do not paint Spell 1 by itself/);
  assert.ok(courtyard >= 0 && peony > courtyard && coaster > peony && outcome > coaster);

  const already = buildStasisVisionPrompt(
    "COMBINATION PIECE: paint one new painting by mixing every spell below into a single scene. Do not paint Spell 1 by itself.\n" +
      "Spell 1 contributes a courtyard. Spell 2 contributes a peony. Spell 3 contributes a coaster.\n\n" +
      stasis,
    [],
    "16:9"
  );
  assert.equal((already.match(/COMBINATION PIECE/g) || []).length, 1);
  assert.equal((already.match(/sunlit Mediterranean courtyard/g) || []).length, 1);
  assert.doesNotMatch(already, /SPELL 1 —/);
  assert.doesNotMatch(already, /Spell II/);
  assert.match(already, /together with/i);
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
  assert.doesNotMatch(prompt, /SPELL I —/);
  assert.match(prompt, /together with/i);
  assert.ok((prompt.match(/Brushwork continues/g) || []).length < 5);
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
  assert.match(prompt, /mixed with/i);
  assert.match(prompt, /combination/i);
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
