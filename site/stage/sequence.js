// Sequence state: maps scroll progress, time and drag input to the state of the
// stage. Pure functions only, no DOM, no clock and no three.js, so it can be tested
// in Node. The stage reads the numbers this returns and does the drawing.
import { ROOM } from "./model.js";

// Where each chapter of the scroll begins and ends (progress 0..1).
export const STAGES = { draw: [0, 0.16], sweep: [0.16, 0.62], hold: [0.62, 0.72], infer: [0.72, 1] };
export const NSLICES = 28;
// Seconds over which the field lines also draw in by themselves after load, so
// the hero is never an empty box (skipped under reduced motion).
export const INTRO_SECONDS = 2.5;
// Resolution of each slice texture [along y, along z]: one field reading per texel.
export const SLICE_RES = [96, 58];
// Centre of each recorded slice along the room's long axis, in cm.
export const SLICE_X = Array.from({ length: NSLICES }, (_, i) => (i + 0.5) * ROOM[0] / NSLICES);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Smooth ease from 0 to 1 between a and b.
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };

// Everything the stage needs for scroll progress p. Drag offsets are added by the
// stage; azimuth and elevation here are the scroll-driven base angles only.
export function sequenceState(p, { time = 0, reducedMotion = false } = {}) {
  const [sweepA, sweepB] = STAGES.sweep;
  const [inferA] = STAGES.infer;
  const intro = reducedMotion ? 1 : smooth(0, INTRO_SECONDS, time);
  const draw = Math.max(smooth(STAGES.draw[0], STAGES.draw[1], p), intro);
  const sweepX = lerp(-70, ROOM[0] + 70, clamp01((p - sweepA) / (sweepB - sweepA)));
  const infer = smooth(inferA, 1, p);

  // The scanning plane fades in as the sweep starts and out as it ends.
  const planeOpacity = smooth(sweepA, sweepA + 0.03, p) * (1 - smooth(sweepB - 0.02, sweepB, p)) * 0.9;

  // Each slice appears as the plane passes it, then dissolves during inference,
  // starting at the walls and moving towards the centre.
  const half = (NSLICES - 1) / 2;
  const sliceOpacity = SLICE_X.map((x, i) => {
    const shown = smooth(x - 4, x + 14, sweepX);
    const order = Math.abs(i - half) / half; // 1 at the walls, 0 at the centre
    const gone = smooth(inferA + 0.02 + (1 - order) * 0.14, inferA + 0.10 + (1 - order) * 0.14, p);
    return shown * (1 - gone) * 0.85;
  });

  // Sources emerge: rings appear, tighten as the fit converges, then the arrow settles.
  const ringReveal = smooth(inferA + 0.06, inferA + 0.12, p);
  const converge = smooth(inferA + 0.10, inferA + 0.26, p);
  const settle = smooth(inferA + 0.18, inferA + 0.27, p);

  // Slow orbit, a little higher and closer at the end; the wobble is skipped under reduced motion.
  const wobble = reducedMotion ? 0 : 0.08 * Math.sin(0.15 * time);
  return {
    draw, sweepX, planeOpacity, infer, restore: infer * 0.85, sliceOpacity,
    ringReveal, converge, settle,
    azimuth: lerp(-0.55, 0.45, p) + wobble,
    elevation: lerp(0.40, 0.30, p),
    pulsesOn: !reducedMotion,
  };
}

// Heat-map colour for t in 0..1 as [r, g, b, a] bytes: transparent navy to near white.
const RAMP = [[0.04, 0.06, 0.16, 0], [0.20, 0.35, 0.78, 0.55], [0.54, 0.71, 0.98, 0.85], [0.92, 0.95, 1, 1]];
export function colourRamp(t) {
  t = clamp01(t);
  const s = t * (RAMP.length - 1), k = Math.min(RAMP.length - 2, Math.floor(s)), f = s - k;
  const out = [0, 1, 2].map((c) => Math.round(255 * (RAMP[k][c] + f * (RAMP[k + 1][c] - RAMP[k][c]))));
  out.push(Math.round(255 * Math.pow(t, 1.3) * 0.95));
  return out;
}

// Where on screen the room may sit, as a window in normalised device
// coordinates (-1..1 across and up). "full": the whole view less a margin.
// "wide": right of the caption column, whose right edge is textRight.
// "stacked" (phones, portrait tablets): below the captions, which are pinned at
// 28vh and end above 60% of the height, and above the readout.
export const COMPOSITION = { margin: 0.04, gap: 0.04, maxLeft: 0.4, stackedTop: -0.2, bottom: -0.86 };

export function compositionFrame(layout, { textRight = -1 } = {}) {
  const { margin: m, gap, maxLeft, stackedTop, bottom } = COMPOSITION;
  if (layout === "wide") return { left: Math.min(maxLeft, Math.max(-1 + m, textRight + gap)), right: 1 - m, bottom, top: 1 - m };
  if (layout === "stacked") return { left: -1 + m, right: 1 - m, bottom, top: stackedTop };
  return { left: -1 + m, right: 1 - m, bottom: -1 + m, top: 1 - m };
}

// The stage pans the camera so the room's centre lands here (as the distance grows).
export const frameCentre = (f) => [(f.left + f.right) / 2, (f.bottom + f.top) / 2];

// Camera distance: the prototype's (closer at the end), or further if needed so
// all eight corners of the room project inside the frame for this view. The
// camera orbits the room centre at (azimuth, elevation), looks at it, then pans
// in the view plane by frameCentre(frame) times the half-width and half-height
// of the view at distance d. A corner at p (from the room centre) then lands at
//   x = (p.right / (t a) + ox d) / (p.fwd + d),   y = (p.up / t + oy d) / (p.fwd + d)
// with t = tan(fovY / 2) and a the aspect, so each frame edge is a linear bound on d.
export function cameraDistance({ aspect, infer = 0, azimuth, elevation, fovY, frame = compositionFrame("full") }) {
  const t = Math.tan((fovY * Math.PI) / 360);
  const ce = Math.cos(elevation), se = Math.sin(elevation), ca = Math.cos(azimuth), sa = Math.sin(azimuth);
  const fwd = [-ce * ca, -ce * sa, -se];          // view direction
  const right = [-sa, ca, 0];                      // fwd x z, normalised
  const up = [-se * ca, -se * sa, ce];             // right x fwd
  const [ox, oy] = frameCentre(frame);
  // Smallest d with lo <= (c + o d) / (w + d) <= hi, given w + d > 0 and lo < o < hi.
  const bound = (c, w, o, lo, hi) => Math.max((c - hi * w) / (hi - o), (lo * w - c) / (o - lo));
  let d = lerp(840, 760, infer);
  for (const x of [-ROOM[0] / 2, ROOM[0] / 2]) for (const y of [-ROOM[1] / 2, ROOM[1] / 2]) for (const z of [-ROOM[2] / 2, ROOM[2] / 2]) {
    const dot = (v) => v[0] * x + v[1] * y + v[2] * z;
    const w = dot(fwd);
    d = Math.max(d, 1 - w,
      bound(dot(right) / (t * aspect), w, ox, frame.left, frame.right),
      bound(dot(up) / t, w, oy, frame.bottom, frame.top));
  }
  return d;
}

// 1/s, how fast the camera closes in again after a turn needed more room.
export const DIST_EASE = 2;

// Displayed camera distance for this frame: never closer than the fit (the whole
// room in the frame), so it moves out at once when the room needs more space and
// closes in slowly afterwards, which keeps the view from pumping during a turn.
// A prev that is not a number (first frame, after a jump) takes the fit.
export function easeDistance(prev, fit, dt) {
  if (!Number.isFinite(prev) || prev <= fit) return fit;
  return prev + (fit - prev) * Math.min(1, dt * DIST_EASE);
}

// Scroll progress through the sequence section, clamped to 0..1.
export function progressWithin(scrollTop, sequenceTop, sequenceHeight, viewportHeight) {
  return clamp01((scrollTop - sequenceTop) / Math.max(1, sequenceHeight - viewportHeight));
}

// Drag to rotate: az and el are offsets added to the scroll-driven camera angles.
// Times are in seconds, from the caller's clock (event timestamps, for instance).
export const createDrag = () => ({ az: 0, el: 0, vAz: 0, vEl: 0, active: false, lx: 0, ly: 0, lt: 0 });
// s, a release this soon after the last move is a flick and keeps the velocity;
// later (dragged, paused, let go) the room stops where it is.
export const FLICK_WINDOW = 0.1;

export function dragStart(drag, x, y, time = 0) {
  drag.active = true; drag.lx = x; drag.ly = y; drag.lt = time; drag.vAz = drag.vEl = 0;
}

export function dragMove(drag, x, y, width, time = 0) {
  if (!drag.active) return;
  const dx = x - drag.lx, dy = y - drag.ly;
  drag.lx = x; drag.ly = y; drag.lt = time;
  const k = 2.2 / Math.max(400, width); // a full-width drag turns about 2.2 rad
  drag.az -= dx * k; drag.el += dy * k;
  drag.vAz = -dx * k; drag.vEl = dy * k;
}

// Release. Given the release time, the velocity survives only for a fresh flick;
// without a time it always survives.
export function dragEnd(drag, time) {
  drag.active = false;
  if (time !== undefined && !(time - drag.lt <= FLICK_WINDOW)) drag.vAz = drag.vEl = 0;
}

// End without momentum (the page took the gesture over, or capture was lost).
export function dragCancel(drag) { drag.active = false; drag.vAz = drag.vEl = 0; }

// Advance by dt seconds: after release the room keeps turning and friction slows it
// to a stop. Elevation is kept off the poles (the camera elevation stays in -0.2..1.35).
export function stepDrag(drag, dt, elevationBase) {
  if (!drag.active) {
    const damp = Math.exp(-dt * 1.4);
    drag.az += drag.vAz * 12 * dt; drag.el += drag.vEl * 12 * dt;
    drag.vAz *= damp; drag.vEl *= damp;
    if (Math.abs(drag.vAz) < 1e-5) drag.vAz = 0;
    if (Math.abs(drag.vEl) < 1e-5) drag.vEl = 0;
  }
  const raw = elevationBase + drag.el;
  const el = Math.min(1.35, Math.max(-0.2, raw));
  if (el !== raw) { drag.el = el - elevationBase; drag.vEl = 0; }
}

// The two-line caption for the current stage.
export function readoutText(p, state) {
  let stage;
  if (p < STAGES.sweep[0]) stage = "field lines · 2 sources";
  else if (p < STAGES.sweep[1]) {
    const x = Math.min(ROOM[0], Math.max(0, state.sweepX));
    const slice = SLICE_X.filter((sx) => sx <= state.sweepX).length;
    stage = `scan · x = ${Math.round(x).toString().padStart(3)} cm · slice ${slice.toString().padStart(2)} / ${NSLICES}`;
  } else if (p < STAGES.infer[0]) stage = `data · ${NSLICES} slices · ${SLICE_RES[0] * SLICE_RES[1] * NSLICES} readings`;
  else stage = `inference · ${Math.round(state.infer * 100).toString().padStart(3)} %`;
  return `${stage}\nroom ${ROOM[0]} × ${ROOM[1]} × ${ROOM[2]} cm`;
}
