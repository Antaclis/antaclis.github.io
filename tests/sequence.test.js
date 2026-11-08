import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOM } from "../site/stage/model.js";
import { STAGES, NSLICES, SLICE_X, sequenceState, colourRamp, cameraDistance, progressWithin,
         INTRO_SECONDS, COMPOSITION, compositionFrame, frameCentre,
         createDrag, dragStart, dragMove, dragEnd, dragCancel, stepDrag, readoutText,
         easeDistance, DIST_EASE, FLICK_WINDOW, countLit } from "../site/stage/sequence.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("stage boundaries and reading planes follow the spec", () => {
  assert.deepEqual(STAGES, { hint: [0, 0.16], sweep: [0.16, 0.62], hold: [0.62, 0.72], infer: [0.72, 1] });
  assert.equal(NSLICES, 28);
  near(SLICE_X[0], 250 / 28); near(SLICE_X[27], 500 - 250 / 28);
});

test("nothing of the field is drawn before the inference: no lines, no plane, no readings", () => {
  for (const p of [0, 0.1, 0.16, 0.39, 0.65, 0.72]) {
    assert.equal(sequenceState(p).draw, 0, `lines hidden at p = ${p}`);
    assert.equal(sequenceState(p).ringReveal, 0);
  }
  assert.equal(sequenceState(0.1).planeOpacity, 0);
  assert.ok(sequenceState(0.1).sweepX < 0, "the plane waits outside the room, so no reading is lit");
});

test("the sweep runs from x = -70 to 570 and the plane is gone in the hold", () => {
  near(sequenceState(0.16).sweepX, -70);
  near(sequenceState(0.62).sweepX, 570);
  const mid = sequenceState(0.39);
  near(mid.sweepX, 250, 1e-9);
  assert.ok(mid.planeOpacity > 0.5 && mid.planeOpacity < 0.7, "translucent: the readings show through");
  assert.ok(sequenceState(0.65).sweepX >= 500, "every reading is lit during the hold");
  assert.equal(sequenceState(0.65).planeOpacity, 0);
});

test("countLit counts the readings the plane has passed", () => {
  const xs = [10, 20, 20, 30, 40];
  assert.equal(countLit(xs, -70), 0);
  assert.equal(countLit(xs, 20), 3);
  assert.equal(countLit(xs, 25), 3);
  assert.equal(countLit(xs, 570), 5);
  assert.equal(countLit([], 100), 0);
});

test("inference reveals the rings, then grows the field while they tighten, then settles the markers", () => {
  const end = sequenceState(1);
  assert.equal(end.ringReveal, 1); assert.equal(end.converge, 1); assert.equal(end.settle, 1);
  assert.equal(end.draw, 1, "the whole field is drawn at the end");
  assert.equal(end.infer, 1, "inference progress is exposed for the camera distance");
  assert.equal(sequenceState(0.5).infer, 0);
  assert.ok(sequenceState(0.86).infer > 0 && sequenceState(0.86).infer < 1);
  const early = sequenceState(0.78);
  assert.ok(early.ringReveal > 0 && early.converge === 0 && early.draw === 0, "rings appear wide first");
  const tightening = sequenceState(0.86);
  assert.ok(tightening.converge > 0 && tightening.converge < 1, "rings are tightening");
  assert.ok(tightening.draw > 0 && tightening.draw < 1, "while the field grows out of the sources");
  assert.ok(tightening.settle < 0.01, "the arrow is still to come");
  assert.ok(sequenceState(0.99).draw === 1 && sequenceState(0.99).settle === 1, "all settled before the end");
});

test("the particles fade in after load, at once under reduced motion", () => {
  assert.equal(INTRO_SECONDS, 2.5);
  assert.equal(sequenceState(0, { time: 0 }).intro, 0);
  const mid = sequenceState(0, { time: 1.25 }).intro;
  assert.ok(mid > 0 && mid < 1, "ramps smoothly");
  assert.equal(sequenceState(0, { time: 2.5 }).intro, 1);
  assert.equal(sequenceState(0, { time: 10 }).intro, 1);
  assert.equal(sequenceState(0, { time: 0, reducedMotion: true }).intro, 1);
  assert.equal(sequenceState(0.5, { time: 0 }).intro, 0, "time-driven, not scroll-driven");
  assert.equal(sequenceState(0).particles, 1, "the particles carry the hint alone");
  near(sequenceState(0.4).particles, 0.4, 1e-9); near(sequenceState(0.65).particles, 0.4, 1e-9);
  near(sequenceState(1).particles, 1, 1e-9);
});

test("camera orbits across the sequence and holds still under reduced motion", () => {
  near(sequenceState(0).azimuth, -0.55); near(sequenceState(1).azimuth, 0.45);
  near(sequenceState(0).elevation, 0.40); near(sequenceState(1).elevation, 0.30);
  const a = sequenceState(0.5, { time: 3 }), b = sequenceState(0.5, { time: 9 });
  assert.notEqual(a.azimuth, b.azimuth);
  const c = sequenceState(0.5, { time: 3, reducedMotion: true }), d = sequenceState(0.5, { time: 9, reducedMotion: true });
  assert.equal(c.azimuth, d.azimuth);
  assert.equal(c.flow, false, "particles stand still under reduced motion"); assert.equal(a.flow, true);
});

test("colour ramp is transparent at zero and near white at one", () => {
  assert.deepEqual(colourRamp(0), [10, 15, 41, 0]);
  const top = colourRamp(1);
  assert.ok(top[0] >= 230 && top[1] >= 240 && top[2] === 255 && top[3] === 242);
});

// Independent projection of the room corners, built the way stage.js places
// the camera: orbit the room centre at (azimuth, elevation, distance), look at
// the centre, then pan in the view plane so the room's centre lands on the
// frame's centre (in normalised device coordinates).
function projectCorners({ aspect, azimuth, elevation, fovY, frame, distance }) {
  const C = [ROOM[0] / 2, ROOM[1] / 2, ROOM[2] / 2];
  const t = Math.tan((fovY * Math.PI) / 360);
  const f = [Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation)];
  const fw = f.map((v) => -v);                                   // view direction
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const right = norm(cross(fw, [0, 0, 1])), up = cross(right, fw);
  const [ox, oy] = frameCentre(frame);
  const pos = C.map((c, k) => c + distance * f[k] - ox * distance * t * aspect * right[k] - oy * distance * t * up[k]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const out = [];
  for (const x of [0, ROOM[0]]) for (const y of [0, ROOM[1]]) for (const z of [0, ROOM[2]]) {
    const q = [x - pos[0], y - pos[1], z - pos[2]];
    const depth = dot(q, fw);
    out.push({ x: dot(q, right) / (depth * t * aspect), y: dot(q, up) / (depth * t), depth });
  }
  return out;
}

test("camera distance fits all eight room corners inside the frame", () => {
  const lerp = (a, b, k) => a + (b - a) * k;
  const fovY = 38, eps = 1e-9;
  for (const aspect of [0.46, 0.75, 1.0, 1.6, 2.16]) {
    const frames = [
      compositionFrame("full"),
      compositionFrame("wide", { textRight: -0.1 }),
      compositionFrame("wide", { textRight: 0.22 }),
      compositionFrame("stacked"),
    ];
    for (const p of [0, 0.39, 1]) {
      const s = sequenceState(p);
      for (const frame of frames) {
        for (const [dAz, dEl] of [[0, 0], [1.3, 0], [-2, 0.9], [0.4, 1.35 - s.elevation], [0, -0.2 - s.elevation]]) {
          const view = { aspect, infer: s.infer, azimuth: s.azimuth + dAz, elevation: s.elevation + dEl, fovY, frame };
          const distance = cameraDistance(view);
          assert.ok(distance >= lerp(840, 760, s.infer) - eps, "never closer than the prototype's distance");
          for (const c of projectCorners({ ...view, distance })) {
            assert.ok(c.depth > 0, "corner in front of the camera");
            assert.ok(c.x >= frame.left - eps && c.x <= frame.right + eps, `x ${c.x} in frame (aspect ${aspect}, p ${p})`);
            assert.ok(c.y >= frame.bottom - eps && c.y <= frame.top + eps, `y ${c.y} in frame (aspect ${aspect}, p ${p})`);
          }
        }
      }
    }
  }
});

test("composition frames keep a margin, sit right of the text when wide and below the captions when stacked", () => {
  const m = COMPOSITION.margin;
  assert.deepEqual(compositionFrame("full"), { left: -1 + m, right: 1 - m, bottom: -1 + m, top: 1 - m });
  const wide = compositionFrame("wide", { textRight: -0.1 });
  assert.ok(wide.left > -0.1 && wide.right === 1 - m, "room right of the caption column");
  const stacked = compositionFrame("stacked");
  assert.ok(stacked.top < 0 && stacked.bottom >= -1 + m, "room below the captions");
  assert.deepEqual(frameCentre(compositionFrame("full")), [0, 0]);
});

test("progress within the sequence clamps on both sides", () => {
  assert.equal(progressWithin(0, 0, 5000, 900), 0);
  assert.equal(progressWithin(-200, 0, 5000, 900), 0);
  near(progressWithin(2050, 0, 5000, 900), 0.5);
  assert.equal(progressWithin(9000, 0, 5000, 900), 1, "deep links past the sequence show the final state");
  assert.ok(Number.isFinite(progressWithin(0, 0, 900, 900)), "no NaN when the sequence is one viewport tall");
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

test("a cancelled drag ends without momentum", () => {
  const d = createDrag();
  dragStart(d, 100, 100, 1); dragMove(d, 103, 100, 1200, 1.01);
  assert.ok(d.vAz !== 0, "the jitter gave it a velocity");
  dragCancel(d);
  assert.equal(d.active, false);
  assert.equal(d.vAz, 0); assert.equal(d.vEl, 0);
  const az = d.az;
  stepDrag(d, 0.1, 0.4); assert.equal(d.az, az, "no residual spin");
});

test("only a fresh flick keeps momentum on release", () => {
  assert.ok(FLICK_WINDOW > 0 && FLICK_WINDOW <= 0.2, "about 100 ms");
  const fresh = createDrag();
  dragStart(fresh, 0, 0, 10); dragMove(fresh, 50, 0, 1200, 10.02);
  dragEnd(fresh, 10.02 + FLICK_WINDOW / 2);
  assert.equal(fresh.active, false);
  assert.ok(fresh.vAz < 0, "a release right after the move keeps turning");
  const stale = createDrag();
  dragStart(stale, 0, 0, 10); dragMove(stale, 50, 30, 1200, 10.02);
  dragEnd(stale, 10.02 + 3 * FLICK_WINDOW);  // dragged, paused, then let go
  assert.equal(stale.active, false);
  assert.equal(stale.vAz, 0); assert.equal(stale.vEl, 0);
  const az = stale.az;
  stepDrag(stale, 0.1, 0.4); assert.equal(stale.az, az, "no stale fling");
});

test("camera distance never closer than the fit, eases in, snaps out", () => {
  assert.ok(DIST_EASE > 0);
  assert.equal(easeDistance(NaN, 800, 0.016), 800, "first frame takes the fit");
  assert.equal(easeDistance(undefined, 800, 0.016), 800);
  assert.equal(easeDistance(700, 800, 0.016), 800, "the room needs more space: out at once");
  assert.equal(easeDistance(800, 800, 0.016), 800);
  const d = easeDistance(900, 800, 0.016);
  assert.ok(d > 800 && d < 900, `closes in slowly: ${d}`);
  assert.ok(easeDistance(d, 800, 0.016) < d, "keeps moving toward the fit");
  assert.equal(easeDistance(900, 800, 10), 800, "a long step lands on the fit");
  for (const [prev, fit, dt] of [[900, 800, 0.1], [1e4, 760, 0.05], [790, 800, 0.5], [801, 800, 0.016]]) {
    assert.ok(easeDistance(prev, fit, dt) >= fit, `never below the fit (${prev}, ${fit}, ${dt})`);
  }
});

test("readout text names the stage in real units", () => {
  const counts = { lit: 120, total: 383 };
  assert.match(readoutText(0.05, sequenceState(0.05), counts), /^field · sources unknown\nroom 500 × 500 × 300 cm$/);
  assert.match(readoutText(0.39, sequenceState(0.39), counts), /^scan · x = 250 cm · 120 readings\n/);
  assert.match(readoutText(0.65, sequenceState(0.65), counts), /^data · 383 readings · 28 planes\n/);
  assert.match(readoutText(1, sequenceState(1), counts), /^inference · 100 %\n/);
  assert.match(readoutText(0.39, sequenceState(0.39)), /^scan · x = 250 cm ·   0 readings\n/, "counts default to zero");
});
