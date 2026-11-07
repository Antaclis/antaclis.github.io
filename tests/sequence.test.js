import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, NSLICES, SLICE_X, sequenceState, colourRamp, cameraDistance, progressWithin,
         createDrag, dragStart, dragMove, dragEnd, stepDrag, readoutText } from "../site/stage/sequence.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("stage boundaries and slice positions follow the spec", () => {
  assert.deepEqual(STAGES, { draw: [0, 0.16], sweep: [0.16, 0.62], hold: [0.62, 0.72], infer: [0.72, 1] });
  assert.equal(NSLICES, 28);
  near(SLICE_X[0], 250 / 28); near(SLICE_X[27], 500 - 250 / 28);
});

test("lines draw in over the first stage and the plane is hidden", () => {
  assert.equal(sequenceState(0).draw, 0);
  assert.equal(sequenceState(0.16).draw, 1);
  assert.equal(sequenceState(0.1).planeOpacity, 0);
  assert.ok(sequenceState(0.1).sliceOpacity.every((o) => o === 0));
});

test("the sweep runs from x = -70 to 570 and leaves slices behind", () => {
  near(sequenceState(0.16).sweepX, -70);
  near(sequenceState(0.62).sweepX, 570);
  const mid = sequenceState(0.39);
  near(mid.sweepX, 250, 1e-9);
  assert.ok(mid.planeOpacity > 0.8);
  assert.ok(mid.sliceOpacity[0] > 0.8, "first slice recorded");
  assert.equal(mid.sliceOpacity[27], 0, "last slice not yet recorded");
  assert.ok(sequenceState(0.65).sliceOpacity.every((o) => o > 0.8), "all slices held");
  assert.equal(sequenceState(0.65).planeOpacity, 0);
});

test("inference dissolves the slices, tightens the rings and settles the markers", () => {
  const end = sequenceState(1);
  assert.ok(end.sliceOpacity.every((o) => o === 0));
  assert.equal(end.ringReveal, 1); assert.equal(end.converge, 1); assert.equal(end.settle, 1);
  near(end.restore, 0.85);
  const early = sequenceState(0.80);
  assert.ok(early.ringReveal > 0 && early.settle === 0, "rings appear before the arrow");
  assert.ok(early.sliceOpacity[0] < early.sliceOpacity[13], "walls dissolve before the centre");
});

test("camera orbits across the sequence and holds still under reduced motion", () => {
  near(sequenceState(0).azimuth, -0.55); near(sequenceState(1).azimuth, 0.45);
  near(sequenceState(0).elevation, 0.40); near(sequenceState(1).elevation, 0.30);
  const a = sequenceState(0.5, { time: 3 }), b = sequenceState(0.5, { time: 9 });
  assert.notEqual(a.azimuth, b.azimuth);
  const c = sequenceState(0.5, { time: 3, reducedMotion: true }), d = sequenceState(0.5, { time: 9, reducedMotion: true });
  assert.equal(c.azimuth, d.azimuth);
  assert.equal(c.pulsesOn, false); assert.equal(a.pulsesOn, true);
});

test("colour ramp is transparent at zero and near white at one", () => {
  assert.deepEqual(colourRamp(0), [10, 15, 41, 0]);
  const top = colourRamp(1);
  assert.ok(top[0] >= 230 && top[1] >= 240 && top[2] === 255 && top[3] === 242);
});

test("camera distance keeps the room in view at any aspect ratio", () => {
  near(cameraDistance(2, 0), 840);
  near(cameraDistance(0.5, 0), 2360);
  near(cameraDistance(1.8, 1), 760);
});

test("progress within the sequence clamps on both sides", () => {
  assert.equal(progressWithin(0, 0, 5000, 900), 0);
  assert.equal(progressWithin(-200, 0, 5000, 900), 0);
  near(progressWithin(2050, 0, 5000, 900), 0.5);
  assert.equal(progressWithin(9000, 0, 5000, 900), 1, "deep links past the sequence show the final state");
});

test("drag has momentum, friction, an elevation clamp and a clean end", () => {
  const d = createDrag();
  dragStart(d, 100, 100); dragMove(d, 160, 100, 1200); assert.ok(d.az < 0 && d.active);
  dragEnd(d);
  const before = d.az;
  stepDrag(d, 0.1, 0.4); assert.ok(d.az < before, "keeps turning after release");
  for (let i = 0; i < 100; i++) stepDrag(d, 0.1, 0.4);
  assert.equal(d.vAz, 0, "friction stops it");
  dragStart(d, 0, 0); dragMove(d, 0, 5000, 1200); dragEnd(d); stepDrag(d, 0.016, 0.4);
  near(0.4 + d.el, 1.35, 1e-9); assert.equal(d.vEl, 0, "clamped at the pole");
  dragStart(d, 0, 0); dragMove(d, 50, 0, 1200); dragEnd(d);
  assert.equal(d.active, false);
});

test("readout text names the stage in real units", () => {
  assert.match(readoutText(0.05, sequenceState(0.05)), /^field lines · 2 sources\nroom 500 × 500 × 300 cm$/);
  assert.match(readoutText(0.39, sequenceState(0.39)), /^scan · x = 250 cm · slice 14 \/ 28\n/);
  assert.match(readoutText(0.65, sequenceState(0.65)), /^data · 28 slices · 155904 readings\n/);
  assert.match(readoutText(1, sequenceState(1)), /^inference · 100 %\n/);
});
