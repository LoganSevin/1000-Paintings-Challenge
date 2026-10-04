import assert from "node:assert/strict";
import test from "node:test";
import { buildAnimateRequest } from "../../netlify/functions/animate-cast.mjs";

test("a still is sent as the video image with a motion prompt", () => {
  const payload = buildAnimateRequest({
    prompt: "Animate this still. Preserve the painting. Motion: red silk banner.",
    image_url: "https://logan7in.art/generated/1.jpg",
    duration: 15,
    aspect_ratio: "16:9",
    resolution: "720p",
  });
  assert.equal(payload.image.url, "https://logan7in.art/generated/1.jpg");
  assert.match(payload.prompt, /red silk banner/);
  assert.equal(payload.duration, 15);
  assert.equal(payload.resolution, "720p");
  assert.equal(payload.model, "grok-imagine-video-1.5");
});

test("an image without a prompt gets a still-motion line", () => {
  const payload = buildAnimateRequest({
    reference_image: "data:image/jpeg;base64,aaaa",
    duration: 12,
    aspect_ratio: "nope",
  });
  assert.equal(payload.image.url, "data:image/jpeg;base64,aaaa");
  assert.match(payload.prompt, /Animate this still/);
  assert.equal(payload.duration, 10);
  assert.equal(payload.aspect_ratio, "16:9");
});

test("stasis already written into the motion prompt is not repeated", () => {
  const notes = "a quiet anvil under red silk";
  const payload = buildAnimateRequest({
    prompt: "Animate this still. Preserve the painting. Motion: " + notes,
    stasis: notes,
    image_url: "https://logan7in.art/generated/2.jpg",
  });
  assert.equal(
    payload.prompt,
    "Animate this still. Preserve the painting. Motion: a quiet anvil under red silk"
  );
  assert.equal(payload.image.url, "https://logan7in.art/generated/2.jpg");
});

test("a long prompt is clipped and the motion line stays at the front", () => {
  const payload = buildAnimateRequest({
    prompt: "Motion first.",
    stasis: "x".repeat(4000),
  });
  assert.ok(payload.prompt.length <= 3500);
  assert.match(payload.prompt, /^Motion first\./);
  assert.equal(payload.image, undefined);
});
