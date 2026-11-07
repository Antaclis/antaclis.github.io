// tests/model.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOM, DIPOLES, fieldAt, magnitudeAt, traceFieldLines, sliceSamples, logWindow, closesAtSource, sliceCrossings } from "../site/stage/model.js";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("room and dipoles match the spec", () => {
  assert.deepEqual(ROOM, [500, 500, 300]);
  assert.deepEqual(DIPOLES[0].position, [150, 350, 60]);
  assert.deepEqual(DIPOLES[0].moment, [0, 0, 1.15]);
  assert.deepEqual(DIPOLES[1].position, [350, 150, 150]);
  assert.ok(Math.abs(Math.hypot(...DIPOLES[1].moment) - 9.2) < 1e-9);
  const u = [1, -1, 0.5].map((v) => v / Math.hypot(1, -1, 0.5));
  DIPOLES[1].moment.forEach((v, k) => assert.ok(Math.abs(v / 9.2 - u[k]) < 1e-12));
});

test("a single dipole is twice as strong on axis as on the equator", () => {
  // Far from the big magnet, the field of the small one dominates only if we
  // evaluate relative to its own centre at a tiny distance; use 1 cm.
  const [p] = DIPOLES.map((d) => d.position);
  const axial = magnitudeAt(p[0], p[1], p[2] + 1);
  const equatorial = magnitudeAt(p[0] + 1, p[1], p[2]);
  assert.ok(Math.abs(axial / equatorial - 2) < 0.01);
});

test("fieldAt writes into and returns the out array", () => {
  const out = [9, 9, 9];
  const r = fieldAt(10, 10, 10, out);
  assert.equal(r, out);
  assert.ok(out.every(Number.isFinite));
});

test("traceFieldLines returns 64 lines that start on the seed sphere and end at a dipole or a wall", () => {
  const lines = traceFieldLines();
  assert.equal(lines.length, 64);
  for (const line of lines) {
    assert.ok(line instanceof Float32Array);
    assert.ok(line.length >= 15 && line.length % 3 === 0);
    const first = [line[0], line[1], line[2]];
    const last = [line.at(-3), line.at(-2), line.at(-1)];
    assert.ok(DIPOLES.some((d) => Math.abs(dist(first, d.position) - 12) < 1e-3));
    const atDipole = DIPOLES.some((d) => dist(last, d.position) < 9 + 2);
    const atWall = [0, 1, 2].some((k) => last[k] < 2.5 || last[k] > ROOM[k] - 2.5);
    assert.ok(atDipole || atWall);
    for (let i = 3; i < line.length; i += 3) {
      const step = Math.hypot(line[i] - line[i - 3], line[i + 1] - line[i - 2], line[i + 2] - line[i - 1]);
      assert.ok(step < 2.05, "RK4 step length stays at 2 cm");
    }
  }
  assert.ok(lines.filter((l) => DIPOLES.some((d) => dist([l.at(-3), l.at(-2), l.at(-1)], d.position) < 11)).length >= 50);
});

test("sliceSamples is finite, indexed row-major and brightest near the big magnet", () => {
  const s = sliceSamples(350);
  assert.equal(s.length, 96 * 58);
  assert.ok(Array.from(s).every(Number.isFinite));
  let best = 0;
  for (let k = 1; k < s.length; k++) if (s[k] > s[best]) best = k;
  const i = best % 96, j = Math.floor(best / 96);
  const y = 500 * (i + 0.5) / 96, z = 300 * (j + 0.5) / 58;
  assert.ok(Math.hypot(y - 150, z - 150) < 8, "the maximum sits on the big magnet at (350, 150, 150)");
});

test("logWindow returns quantiles of the sorted samples", () => {
  const w = logWindow(Float32Array.from({ length: 1000 }, (_, k) => k));
  assert.equal(w.lo, 250);
  assert.equal(w.hi, 997);
});

test("closesAtSource tells lines that return to a dipole from lines that leave through a wall", () => {
  const lines = traceFieldLines();
  const closed = lines.filter((l) => closesAtSource(l));
  assert.ok(closed.length >= 40 && closed.length < lines.length, `${closed.length} closed of ${lines.length}`);
  for (const l of lines) {
    const last = [l.at(-3), l.at(-2), l.at(-1)];
    const atDipole = DIPOLES.some((d) => dist(last, d.position) < 12);
    assert.equal(closesAtSource(l), atDipole);
  }
  assert.equal(closesAtSource(Float32Array.from([0, 0, 0, 250, 250, 150])), false);
  assert.equal(closesAtSource(Float32Array.from([0, 0, 0, 150, 350, 65])), true);
});

test("sliceCrossings finds where the planes cut the lines", () => {
  // A straight line from (10, 0, 0) to (110, 100, 50), 11 points: planes at x = 25 and 75 cut it.
  const line = Float32Array.from({ length: 33 }, (_, k) => [10 + 10 * Math.floor(k / 3), 10 * Math.floor(k / 3), 5 * Math.floor(k / 3)][k % 3]);
  const c = sliceCrossings([line], [25, 75, 500]);
  assert.equal(c.t.length, 2);
  assert.deepEqual(Array.from(c.pos), [25, 15, 7.5, 75, 65, 32.5]);
  assert.ok(Math.abs(c.t[0] - 0.15) < 1e-6 && Math.abs(c.t[1] - 0.65) < 1e-6, "t is the position along the line");
  assert.deepEqual(Array.from(c.line), [0, 0]);

  const xs = Array.from({ length: 28 }, (_, i) => (i + 0.5) * 500 / 28);
  const real = sliceCrossings(traceFieldLines(), xs);
  assert.ok(real.t.length > 300 && real.t.length < 600, `${real.t.length} readings: sparse, not a heat map`);
  for (let k = 0; k < real.t.length; k++) {
    assert.ok(xs.some((x) => Math.abs(x - real.pos[3 * k]) < 1e-4), "every reading sits on a plane");
    assert.ok(real.t[k] >= 0 && real.t[k] <= 1);
  }
});
