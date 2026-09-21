"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const g = require("./reader.js");

test("double-tap from default size zooms so the tap stays under the finger", () => {
  const w = 400;
  const h = 800;
  const pt = { x: 100, y: 200 };
  const z = g.pageZoomToggleAt({ s: 1, x: 0, y: 0 }, pt, g.PAGE_ZOOM_TAP, w, h);
  assert.ok(z.s > 1.5);
  assert.equal(z.s, g.PAGE_ZOOM_TAP);
  const localX = (0 - z.x) / z.s;
  const localY = (0 - z.y) / z.s;
  // screen point = local * s + translate; local at tap was tap itself at s=1
  assert.ok(Math.abs(pt.x * z.s + z.x - pt.x) < 0.51);
  assert.ok(Math.abs(pt.y * z.s + z.y - pt.y) < 0.51);
  void localX;
  void localY;
});

test("double-tap while zoomed returns to the default reading size", () => {
  const z = g.pageZoomToggleAt({ s: 2.5, x: -80, y: -120 }, { x: 40, y: 90 }, g.PAGE_ZOOM_TAP, 400, 800);
  assert.deepEqual(z, { s: 1, x: 0, y: 0 });
});

test("two taps in time and place count as a double tap", () => {
  const first = { t: 1000, x: 50, y: 60 };
  assert.equal(g.isDoubleTap(first, { x: 55, y: 62 }, 1240), true);
  assert.equal(g.isDoubleTap(first, { x: 55, y: 62 }, 1401), false);
  assert.equal(g.isDoubleTap(first, { x: 200, y: 60 }, 1100), false);
  assert.equal(g.isDoubleTap(null, { x: 50, y: 60 }, 1100), false);
});

function fakeNode(hitSelector) {
  return {
    closest(sel) {
      if (!hitSelector) return null;
      const parts = String(sel).split(",").map((s) => s.trim());
      return parts.includes(hitSelector) ? this : null;
    },
  };
}

test("bottom progress chrome is reader chrome, page hits are not", () => {
  assert.equal(g.isReaderChromeNode(fakeNode("#bottomMenu")), true);
  assert.equal(g.isReaderChromeNode(fakeNode("#sliderContainer")), true);
  assert.equal(g.isReaderChromeNode(fakeNode("#topMenu")), true);
  assert.equal(g.isReaderChromeNode(fakeNode("input")), true);
  assert.equal(g.isReaderChromeNode(fakeNode(".pageHit")), false);
  assert.equal(g.isReaderChromeNode(null), false);
});

test("a follow-up dblclick right after a touch double-tap is ignored", () => {
  assert.equal(g.zoomToggleFresh(0, 1000), true);
  assert.equal(g.zoomToggleFresh(1000, 1200), false);
  assert.equal(g.zoomToggleFresh(1000, 1000 + g.ZOOM_TOGGLE_GAP), true);
});

test("iOS native range drag is not claimed by reader preventDefault", () => {
  const range = { tagName: "INPUT", type: "range" };
  const page = fakeNode(".pageHit");
  assert.equal(g.touchAllowsNativePan({
    target: range,
    composedPath() { return [range]; },
  }), true);
  assert.equal(g.touchAllowsNativePan({
    target: fakeNode("#bottomMenu"),
    composedPath() { return [fakeNode("#sliderContainer"), fakeNode("#bottomMenu")]; },
  }), true);
  assert.equal(g.touchAllowsNativePan({
    target: page,
    composedPath() { return [page]; },
  }), false);
});
