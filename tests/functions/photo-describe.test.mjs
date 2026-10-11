import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_CAPTION_MODEL,
  LOCAL_CAPTION_NOTE,
  isLocalCaption,
  shouldKeepLocalCaption,
} from "../../netlify/functions/_transfer-store.mjs";

test("a chosen Describe does not keep the skipped caption", () => {
  const credits = new Error("Team is out of credits and at its spending limit");
  assert.equal(shouldKeepLocalCaption(credits, false), true);
  assert.equal(shouldKeepLocalCaption(credits, true), false);
  assert.equal(shouldKeepLocalCaption(new Error("network down"), false), false);
  assert.equal(
    isLocalCaption({ model: LOCAL_CAPTION_MODEL, description: "anything" }),
    true
  );
  assert.equal(isLocalCaption({ description: LOCAL_CAPTION_NOTE }), true);
  assert.equal(
    isLocalCaption({ model: "grok-4", description: "A red door in the rain." }),
    false
  );
});
