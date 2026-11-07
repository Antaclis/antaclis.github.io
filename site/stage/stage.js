/* ==========================================================================
   Antaclis, the scroll-driven field scan behind the opening captions

   Two hidden magnets fill a 5 x 5 x 3 m room with a field nobody can see. As
   the visitor scrolls through #sequence:
     - hint: the field itself is never drawn; a few hundred small lights drift
       along its lines, so there is clearly structure in the room but not what;
     - measure: a plane sweeps the room, showing the field strength on its
       surface, and wherever it cuts a field line it leaves an orange reading
       that flashes and settles to an ember; by the end only the readings remain;
     - infer: an uncertainty sphere (three rings) appears at each source and
       tightens; while it does, the true field grows out of each source along
       its lines, from both ends of a line at once until they meet, and takes
       every reading with it; an arrow along each moment and a glowing core
       settle last. At the end the whole field is there and nothing orange is.
   Dragging rotates the room; a flick keeps it turning until friction stops it.

   This file only draws. The physics (field, lines, crossings) is in model.js
   and everything that depends on scroll, time or drag (stage boundaries,
   sweep, reveal timing, camera path and distance easing, drag law and flick
   window) is in sequence.js; both are tested in Node. Constants here are
   visual only (colours, sizes, opacities, layout, particle flow), plus the
   three UI timings the brief fixes: scroll easing rate, frame-step cap and
   drag-hint timeout.

   The page works without this script: unless WebGL starts, <html> never gets
   the class has-stage, the stage stays hidden and the static SVG stays. If
   start-up fails after that (a shader or driver problem), start() takes the
   class away again and the static SVG comes back.
   Debug: ?nowebgl=1 forces that fallback; ?p=0.45 jumps to progress 0.45
   (with the load-time fade-in already finished).
   ========================================================================== */
import * as THREE from "../vendor/three.module.min.js";
import { ROOM, DIPOLES, traceFieldLines, closesAtSource, sliceCrossings, sliceSamples, logWindow } from "./model.js";
import {
  SLICE_X, SLICE_RES, INTRO_SECONDS, sequenceState, colourRamp, cameraDistance, compositionFrame, frameCentre, progressWithin,
  createDrag, dragStart, dragMove, dragEnd, dragCancel, stepDrag, easeDistance, readoutText, countLit,
} from "./sequence.js";

/* ---- Visual constants ---------------------------------------------------- */
const ACCENT = 0x8ab6f9;     // field lines, rings, room edges, particle trails
const GLOW = 0xdce9ff;       // plane outline, arrows, cores, particle heads, line tips
const ORANGE = 0xff8a3d;     // a reading, once settled
const FLASH = 0xffd9ae;      // a reading the moment the plane records it
const FOV = 38;              // degrees, vertical
const LINE_ALPHA = 0.75;     // field-line opacity at full strength
const EDGE_ALPHA = 0.10;     // room edges
const OUTLINE_ALPHA = 1.2;   // scanning-plane outline, relative to the plane
const READING_SIZE = 11;     // cm, a settled reading (it flashes to about three times that)
const READING_ALPHA = 1;
const MARKER_ALPHA = 0.95;   // arrows and cores once settled
const ARROW_SIZE = 26;       // cm, arrow length of the smaller source (others scale with |m|^(1/3))
const RING_WIDE = 110;       // cm, uncertainty-sphere radius when the rings appear
const RING_TIGHT = 0.28;     // final radius, as a fraction of the arrow length
const RING_SPIN = 0.12;      // rad/s, slow ambient turn of the rings
const RING_ALPHA = [0.45, 0.85];  // ring opacity while wide, and once tightened
const RING_FADE_IN = 2.5;    // rings reach full opacity at 40% of their reveal
// Particles drifting along the (invisible) field lines.
const PARTICLES = 57;        // how many are in the room at once
const PARTICLE_SPEED = 17;   // line points per second (34 cm/s), the same for all, so none overtakes another
const PARTICLE_SIZE = 12;    // cm, the head
const PARTICLE_ALPHA = 0.9;
const TRAIL_POINTS = 16;     // line points of trail behind each head (the lines are traced at 2 cm)
const TRAIL_ALPHA = 0.55;    // trail opacity where it meets the head; it fades to nothing at its end
const PARTICLE_FADE = 15;    // line points over which a particle fades out at the end of its line
const PARTICLE_BORN = 1.5;   // s, fade-in of a particle that has just started on a line
const PARTICLE_CLEAR = [25, 100];  // cm from a source: fully dim inside, full brightness beyond
const PARTICLE_APART = 60;   // cm, a new particle never starts closer than this to another (best of a few tries)
const EASE_RATE = 7;         // 1/s, how fast displayed progress follows the scroll
const MAX_DT = 0.1;          // s, longest frame step (after a hidden tab, for instance)
const HINT_TIMEOUT = 8000;   // ms before the drag hint hides on its own
// Composition (frames in sequence.js). Wide or landscape screens, same query as
// the horizontal scrim in styles.css: the whole room right of the caption
// column. Otherwise (phones, portrait tablets): the whole room below the captions.
const WIDE = "(min-width: 56rem), (min-aspect-ratio: 3/2)";

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };

/* ---- Start-up: give up quietly whenever the fallback should stay --------- */
const canvas = document.getElementById("stage-canvas");
const sequence = document.getElementById("sequence");
let renderer = null;
if (canvas && sequence && !/[?&]nowebgl=1\b/.test(location.search)) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (_) {
    renderer = null;  // no WebGL 2: keep the static drawing
  }
}
if (renderer) start(renderer);

// Runs the stage, guarded: if anything throws on the way (a shader or driver
// problem, for instance), or a later frame does, fail() undoes what run() set up
// and the page shows the static drawing, as with ?nowebgl=1.
function start(renderer) {
  const controller = new AbortController();
  const life = {
    signal: controller.signal,  // on every listener run() adds
    observers: [],              // disconnected on failure
    hintTimer: 0,
    failed: false,
    fail(err) {
      if (life.failed) return;
      life.failed = true;       // stops the render loop and any pending scroll fix
      controller.abort();
      life.observers.forEach((o) => o.disconnect());
      clearTimeout(life.hintTimer);
      document.documentElement.classList.remove("has-stage");
      for (const id of ["readout", "drag-hint"]) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      }
      try { if ("scrollRestoration" in history) history.scrollRestoration = "auto"; } catch (_) { /* ignore */ }
      try { renderer.dispose(); } catch (_) { /* already gone */ }
      console.warn("Antaclis: the 3D stage could not run, showing the static drawing instead.", err);
    },
  };
  try {
    run(renderer, life);
  } catch (err) {
    life.fail(err);
  }
}

function run(renderer, life) {
  const { signal } = life;
  const root = document.documentElement;
  const stage = document.getElementById("stage");
  const readout = document.getElementById("readout");
  const hint = document.getElementById("drag-hint");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const wide = matchMedia(WIDE);

  // Show the stage before measuring anything: it is display:none until now.
  root.classList.add("has-stage");
  if (readout) readout.hidden = false;
  if (hint) hint.hidden = false;

  // Colours as in the prototype (three.js r128, no colour management): hex
  // values, textures and the custom shaders all stay in sRGB, blended as is.
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  // A shader that fails to link throws (three.js only logs it by default), so
  // the guard in start() can fall back.
  renderer.debug.onShaderError = () => { throw new Error("a stage shader failed to compile"); };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);
  camera.up.set(0, 0, 1);  // room coordinates: z is up
  const CENTRE = new THREE.Vector3(ROOM[0] / 2, ROOM[1] / 2, ROOM[2] / 2);

  // Draw order of the transparent layers, back to front: readings and lines
  // show through the plane, the lights ride on top of the lines and the
  // markers sit on top of everything. Within a layer three.js sorts by depth.
  const LAYER = { edges: 0, plane: 1, readings: 2, lines: 3, particles: 4, markers: 5 };

  // Point sprites (particles, readings) are sized in cm: a point of size s at
  // view depth z covers s * uScale / z device pixels. Set on resize.
  const pointScale = { value: 1 };

  /* ---- Room edges -------------------------------------------------------- */
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM[0], ROOM[1], ROOM[2])),
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: EDGE_ALPHA, depthWrite: false }),
  );
  edges.position.copy(CENTRE);
  edges.renderOrder = LAYER.edges;
  scene.add(edges);

  /* ---- The field: its lines, and how they are revealed ---------------------
     Every line starts at a seed next to a source; 48 of the 64 end at a source
     too (closed), the rest leave through a wall. The reveal, shared by the line
     shader and the readings, grows each line from its seed as uDraw rises
     (lines start at staggered moments, aPh) and, for a closed line, from its
     far end as well, so the two halves meet. */
  const lines = traceFieldLines();
  const lineClosed = lines.map((pts) => (closesAtSource(pts) ? 1 : 0));
  const linePhase = lines.map((_, li) => (li * 0.618) % 1);
  const REVEAL = /* glsl */ `
    // 0 where the line is still hidden at position t, 1 where it is drawn.
    float reveal(float t, float ph, float closed, float draw) {
      float d = draw * 1.3 - ph * 0.3;
      float fromSeed = 1.0 - smoothstep(d - 0.04, d, t);
      float fromEnd = smoothstep(1.0 - d, 1.0 - d + 0.04, t) * closed;
      return max(fromSeed, fromEnd);
    }`;

  /* ---- Field lines: one LineSegments, drawn by a small shader --------------
     aT is the position along the line (0 to 1), aPh the line's phase and aEnd
     whether it is closed. The fragment shader applies the reveal, tapers the
     ends and lights the growing tips. */
  const lineUniforms = {
    uDraw: { value: 0 }, uAlpha: { value: LINE_ALPHA },
    uColor: { value: new THREE.Color(ACCENT) }, uTip: { value: new THREE.Color(GLOW) },
  };
  {
    let segments = 0;
    for (const pts of lines) segments += pts.length / 3 - 1;
    const pos = new Float32Array(segments * 6), aT = new Float32Array(segments * 2);
    const aPh = new Float32Array(segments * 2), aEnd = new Float32Array(segments * 2);
    let s = 0;
    lines.forEach((pts, li) => {
      const n = pts.length / 3;
      for (let i = 0; i < n - 1; i++, s++) {
        pos.set(pts.subarray(3 * i, 3 * i + 6), 6 * s);
        aT[2 * s] = i / (n - 1); aT[2 * s + 1] = (i + 1) / (n - 1);
        aPh[2 * s] = aPh[2 * s + 1] = linePhase[li];
        aEnd[2 * s] = aEnd[2 * s + 1] = lineClosed[li];
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    geometry.setAttribute("aPh", new THREE.BufferAttribute(aPh, 1));
    geometry.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: lineUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute float aPh;
        attribute float aEnd;
        varying float vT;
        varying float vPh;
        varying float vEnd;
        void main() {
          vT = aT; vPh = aPh; vEnd = aEnd;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uDraw, uAlpha;
        uniform vec3 uColor, uTip;
        varying float vT;
        varying float vPh;
        varying float vEnd;
        ${REVEAL}
        void main() {
          float drawn = reveal(vT, vPh, vEnd, uDraw);
          float taper = smoothstep(0.0, 0.03, vT) * (1.0 - smoothstep(0.97, 1.0, vT));
          // A bright tip rides each growing end and goes out once the line is whole.
          float d = uDraw * 1.3 - vPh * 0.3;
          float tip = exp(-abs(vT - d) * 30.0) + vEnd * exp(-abs(vT - (1.0 - d)) * 30.0);
          tip = min(1.0, tip) * (1.0 - smoothstep(0.85, 1.0, uDraw));
          gl_FragColor = vec4(mix(uColor, uTip, tip), uAlpha * drawn * taper * (0.85 + 0.6 * tip));
        }`,
    });
    const fieldLines = new THREE.LineSegments(geometry, material);
    fieldLines.renderOrder = LAYER.lines;
    scene.add(fieldLines);
  }

  /* ---- Point sprite: a soft round light ------------------------------------ */
  const dotTexture = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.22, "rgba(255,255,255,0.55)");
    r.addColorStop(0.55, "rgba(255,255,255,0.12)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  /* ---- Particles: lights drifting along the lines --------------------------
     Each particle rides one line at the common speed, fades out over the last
     few points, then starts again somewhere along another line (chosen with
     probability proportional to length, so the room is lit evenly per metre of
     line), never right next to another light, and fades in over a second or
     so. Near a source the lights dim, so
     where the lines bunch up the room does not glow and give the source away.
     Behind each head a short trail follows the line itself, fading towards
     its end. The CPU moves them; a Points mesh draws the heads and a
     LineSegments mesh the trails, both with per-vertex alpha. */
  const particleUniforms = {
    uScale: pointScale, uAlpha: { value: 0 },
    uColor: { value: new THREE.Color(ACCENT) }, uHead: { value: new THREE.Color(GLOW) }, uMap: { value: dotTexture },
  };
  const particles = (() => {
    const cumulative = [];
    let total = 0;
    for (const pts of lines) cumulative.push(total += pts.length / 3 - 1);
    const pickLine = () => {
      const r = Math.random() * total;
      let lo = 0, hi = cumulative.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] <= r) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const line = new Int32Array(PARTICLES), at = new Float32Array(PARTICLES), age = new Float32Array(PARTICLES);
    // Heads: one point sprite each.
    const headPos = new Float32Array(PARTICLES * 3), headAlpha = new Float32Array(PARTICLES);
    // Position on line pts at fractional point index q, into out[o..o+2].
    const sample = (pts, n, q, out, o) => {
      const j = Math.min(n - 2, Math.floor(q)), f = q - j;
      out[o] = pts[3 * j] + f * (pts[3 * j + 3] - pts[3 * j]);
      out[o + 1] = pts[3 * j + 1] + f * (pts[3 * j + 4] - pts[3 * j + 1]);
      out[o + 2] = pts[3 * j + 2] + f * (pts[3 * j + 5] - pts[3 * j + 2]);
    };
    // Start particle i somewhere along a line, partway in, away from the others:
    // of a few random candidates, the one farthest from every other head (the
    // first that is at least PARTICLE_APART away wins outright).
    const candidate = [0, 0, 0];
    const spawn = (i) => {
      let bestLine = 0, bestAt = 0, bestGap = -1;
      for (let tries = 0; tries < 8; tries++) {
        const li = pickLine(), pts = lines[li], n = pts.length / 3;
        const q = (0.1 + 0.7 * Math.random()) * (n - 1);
        sample(pts, n, q, candidate, 0);
        let gap = Infinity;
        for (let k = 0; k < PARTICLES; k++) {
          if (k === i) continue;
          gap = Math.min(gap, Math.hypot(candidate[0] - headPos[3 * k], candidate[1] - headPos[3 * k + 1], candidate[2] - headPos[3 * k + 2]));
        }
        if (gap > bestGap) { bestGap = gap; bestLine = li; bestAt = q; }
        if (gap >= PARTICLE_APART) break;
      }
      line[i] = bestLine; at[i] = bestAt;
      sample(lines[bestLine], lines[bestLine].length / 3, bestAt, headPos, 3 * i);
    };
    headPos.fill(1e6);  // nothing placed yet
    for (let i = 0; i < PARTICLES; i++) {
      spawn(i);
      age[i] = PARTICLE_BORN;  // the first generation is already there
    }
    // Brightness by distance from the nearest source.
    const clear = (x, y, z) => {
      let d = Infinity;
      for (const { position: q } of DIPOLES) d = Math.min(d, Math.hypot(x - q[0], y - q[1], z - q[2]));
      return clamp01((d - PARTICLE_CLEAR[0]) / (PARTICLE_CLEAR[1] - PARTICLE_CLEAR[0]));
    };

    const headGeometry = new THREE.BufferGeometry();
    const headPosAttr = new THREE.BufferAttribute(headPos, 3).setUsage(THREE.DynamicDrawUsage);
    const headAlphaAttr = new THREE.BufferAttribute(headAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    headGeometry.setAttribute("position", headPosAttr);
    headGeometry.setAttribute("aAlpha", headAlphaAttr);
    const heads = new THREE.Points(headGeometry, new THREE.ShaderMaterial({
      uniforms: particleUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aAlpha;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = ${PARTICLE_SIZE.toFixed(1)} * uScale / max(1.0, -mv.z) * step(0.002, aAlpha);
          gl_Position = projectionMatrix * mv;
          vA = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor, uHead;
        uniform float uAlpha;
        varying float vA;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(mix(uColor, uHead, 0.5), a * vA * uAlpha);
        }`,
    }));

    // Trails: TRAIL_POINTS segments per particle, two vertices each.
    const SEG = TRAIL_POINTS, trailPos = new Float32Array(PARTICLES * SEG * 6), trailAlpha = new Float32Array(PARTICLES * SEG * 2);
    const trailGeometry = new THREE.BufferGeometry();
    const trailPosAttr = new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage);
    const trailAlphaAttr = new THREE.BufferAttribute(trailAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    trailGeometry.setAttribute("position", trailPosAttr);
    trailGeometry.setAttribute("aAlpha", trailAlphaAttr);
    const trails = new THREE.LineSegments(trailGeometry, new THREE.ShaderMaterial({
      uniforms: particleUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vA;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vA = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying float vA;
        void main() { gl_FragColor = vec4(uColor, vA * uAlpha); }`,
    }));
    // No frustum culling: the bounding spheres would need recomputing every frame.
    heads.frustumCulled = trails.frustumCulled = false;
    heads.renderOrder = trails.renderOrder = LAYER.particles;
    scene.add(trails, heads);

    // Advance by dt seconds (0 keeps every particle where it is) and write
    // the heads and trails.
    const step = (dt) => {
      for (let i = 0; i < PARTICLES; i++) {
        let pts = lines[line[i]], n = pts.length / 3;
        at[i] += PARTICLE_SPEED * dt;
        age[i] += dt;
        if (at[i] >= n - 1) {
          spawn(i); pts = lines[line[i]]; n = pts.length / 3;
          age[i] = 0;
        }
        // Brightness of the whole particle: fading in, fading out at the line's end, dim near a source.
        sample(pts, n, at[i], headPos, 3 * i);
        const bright = Math.min(age[i] / PARTICLE_BORN, (n - 1 - at[i]) / PARTICLE_FADE, 1)
          * clear(headPos[3 * i], headPos[3 * i + 1], headPos[3 * i + 2]);
        headAlpha[i] = bright;
        // The trail: samples at at - k, k = 0..SEG, as SEG segments.
        for (let k = 0; k < SEG; k++) {
          const v = (i * SEG + k) * 2;          // first vertex of the segment
          const q0 = at[i] - k, q1 = at[i] - k - 1;
          if (q1 < 0) {                         // past the line's start: collapse the segment
            for (let c = 0; c < 3; c++) trailPos[3 * v + c] = trailPos[3 * v + 3 + c] = headPos[3 * i + c];
            trailAlpha[v] = trailAlpha[v + 1] = 0;
            continue;
          }
          sample(pts, n, q0, trailPos, 3 * v);
          sample(pts, n, q1, trailPos, 3 * v + 3);
          const fade = TRAIL_ALPHA * bright;
          trailAlpha[v] = fade * (1 - k / SEG);
          trailAlpha[v + 1] = fade * (1 - (k + 1) / SEG);
        }
      }
      headPosAttr.needsUpdate = headAlphaAttr.needsUpdate = trailPosAttr.needsUpdate = trailAlphaAttr.needsUpdate = true;
    };
    step(0);
    return { step };
  })();

  /* ---- Readings: where the plane cut a line, one orange light --------------
     Fixed positions, computed once. The vertex shader lights each as the sweep
     passes its x (a flash that decays with the distance the plane has gone
     on), and puts it out with the same reveal as the lines, so a reading
     disappears exactly as the line it sits on arrives. */
  const readings = sliceCrossings(lines, SLICE_X);
  const readingXs = Float64Array.from({ length: readings.t.length }, (_, k) => readings.pos[3 * k]).sort();
  const readingUniforms = {
    uScale: pointScale, uSweep: { value: -1e4 }, uDraw: { value: 0 }, uTime: { value: 0 }, uShimmer: { value: 1 },
    uAlpha: { value: READING_ALPHA }, uSize: { value: READING_SIZE },
    uColor: { value: new THREE.Color(ORANGE) }, uFlash: { value: new THREE.Color(FLASH) }, uMap: { value: dotTexture },
  };
  {
    const n = readings.t.length;
    const aPh = new Float32Array(n), aEnd = new Float32Array(n), aSeed = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      aPh[k] = linePhase[readings.line[k]];
      aEnd[k] = lineClosed[readings.line[k]];
      aSeed[k] = ((k * 0.7548776662) % 1);  // quasi-random, so no two neighbours shimmer in step
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(readings.pos, 3));
    geometry.setAttribute("aT", new THREE.BufferAttribute(readings.t, 1));
    geometry.setAttribute("aPh", new THREE.BufferAttribute(aPh, 1));
    geometry.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
    const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: readingUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uScale, uSweep, uDraw, uTime, uShimmer, uSize;
        attribute float aT;
        attribute float aPh;
        attribute float aEnd;
        attribute float aSeed;
        varying float vA, vFlash;
        ${REVEAL}
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float lit = smoothstep(position.x - 3.0, position.x + 3.0, uSweep);
          float flash = lit * exp(-max(0.0, uSweep - position.x) / 55.0);
          float shimmer = 1.0 - 0.18 * uShimmer * (0.5 + 0.5 * sin(uTime * 1.7 + aSeed * 6.2832));
          float kept = 1.0 - reveal(aT, aPh, aEnd, uDraw);
          vA = lit * kept * mix(shimmer, 1.0, flash);
          vFlash = flash;
          float size = uSize * (0.8 + 0.4 * aSeed) * (1.0 + 1.8 * flash);
          gl_PointSize = size * uScale / max(1.0, -mv.z) * step(0.002, vA);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor, uFlash;
        uniform float uAlpha;
        varying float vA, vFlash;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(mix(uColor, uFlash, vFlash), a * vA * uAlpha);
        }`,
    }));
    points.frustumCulled = false;
    points.renderOrder = LAYER.readings;
    scene.add(points);
  }

  /* ---- The scanning plane: a live texture of the field strength at its x --- */
  const [TW, TH] = SLICE_RES;
  // Colour window from a few sample planes across the room, so the map is steady.
  const win = (() => {
    const xs = SLICE_X.filter((_, i) => i % 4 === 1);
    const all = new Float32Array(xs.length * TW * TH);
    xs.forEach((x, i) => all.set(sliceSamples(x, TW, TH), i * TW * TH));
    return logWindow(all);
  })();
  const planeTex = new THREE.DataTexture(new Uint8Array(TW * TH * 4), TW, TH, THREE.RGBAFormat);
  planeTex.magFilter = planeTex.minFilter = THREE.LinearFilter;
  // Row j of the samples is height z, column i is y; texel (i, j) maps to uv (i, j).
  const paint = (tex, samples) => {
    const data = tex.image.data;
    for (let k = 0; k < samples.length; k++) data.set(colourRamp((samples[k] - win.lo) / (win.hi - win.lo)), 4 * k);
    tex.needsUpdate = true;
  };
  // A quad spanning the room's y-z cross-section at x = 0, with uv along y and z.
  const planeGeometry = new THREE.BufferGeometry();
  planeGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, ROOM[1], 0, 0, ROOM[1], ROOM[2], 0, 0, ROOM[2]], 3));
  planeGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  planeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  const plane = new THREE.Mesh(planeGeometry,
    new THREE.MeshBasicMaterial({ map: planeTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setAttribute("position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, ROOM[1], 0, 0, ROOM[1], ROOM[2], 0, 0, ROOM[2]], 3)),
    new THREE.LineBasicMaterial({ color: GLOW, transparent: true, opacity: 0 }),
  );
  plane.renderOrder = outline.renderOrder = LAYER.plane;
  scene.add(plane, outline);
  let paintedX = NaN;

  /* ---- The answer: each source as an inferred result ---------------------
     A glowing core, a thin arrow along the moment (length ~ |m|^(1/3)) and an
     uncertainty sphere, three rings in the room's coordinate planes, that
     tightens as the inference converges. */
  const glowTexture = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(220,233,255,0.9)");
    r.addColorStop(0.3, "rgba(138,182,249,0.35)");
    r.addColorStop(1, "rgba(138,182,249,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const ringGeometry = (() => {
    const pts = [];
    for (let i = 0; i < 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push(Math.cos(a), Math.sin(a), 0); }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  })();
  const smallest = Math.min(...DIPOLES.map(({ moment: m }) => Math.hypot(m[0], m[1], m[2])));
  const markers = DIPOLES.map(({ position: p, moment: m }) => {
    const L = ARROW_SIZE * Math.cbrt(Math.hypot(m[0], m[1], m[2]) / smallest);
    const group = new THREE.Group();
    group.position.set(p[0], p[1], p[2]);

    const ringMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false });
    const rings = new THREE.Group();
    const r2 = new THREE.LineLoop(ringGeometry, ringMat); r2.rotation.x = Math.PI / 2;
    const r3 = new THREE.LineLoop(ringGeometry, ringMat); r3.rotation.y = Math.PI / 2;
    rings.add(new THREE.LineLoop(ringGeometry, ringMat), r2, r3);

    const arrowMat = new THREE.LineBasicMaterial({ color: GLOW, transparent: true, opacity: 0, depthWrite: false });
    const tipMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, depthWrite: false });
    const arrow = new THREE.Group();
    const shaft = new THREE.Line(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -L / 2, 0, 0, L / 2], 3)),
      arrowMat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(L * 0.07, L * 0.22, 16), tipMat);
    tip.rotation.x = Math.PI / 2;  // the cone points along +y; turn it to +z
    tip.position.z = L / 2;
    arrow.add(shaft, tip);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...unit(m)));

    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    core.scale.set(L * 1.6, L * 1.6, 1);

    group.add(rings, arrow, core);
    group.visible = false;
    group.traverse((o) => { o.renderOrder = LAYER.markers; });
    scene.add(group);
    return { group, rings, ringMat, arrow, arrowMat, tipMat, core, L };
  });

  /* ---- Per-frame state ----------------------------------------------------- */
  // sequenceState gives the scroll-driven values; apply() puts them on the scene.
  const drag = createDrag();
  const pan = new THREE.Vector3();
  let time = 0;          // s, drives the ambient motion
  let target = 0;        // scroll progress through #sequence
  let progress = 0;      // displayed progress, eased toward target
  let dirty = true;      // something other than time changed since the last frame
  let fitFrame = compositionFrame("full");  // where the room must fit on screen
  let distance = NaN;    // displayed camera distance (NaN: take the fit at once)

  function apply(p, dt) {
    const state = sequenceState(p, { time, reducedMotion: reducedMotion.matches });

    lineUniforms.uDraw.value = state.draw;

    particles.step(state.flow ? dt : 0);
    particleUniforms.uAlpha.value = state.intro * state.particles * PARTICLE_ALPHA;

    readingUniforms.uSweep.value = state.sweepX;
    readingUniforms.uDraw.value = state.draw;
    readingUniforms.uTime.value = time;
    readingUniforms.uShimmer.value = state.flow ? 1 : 0;

    plane.position.x = outline.position.x = state.sweepX;
    plane.material.opacity = state.planeOpacity;
    outline.material.opacity = Math.min(1, state.planeOpacity * OUTLINE_ALPHA);
    plane.visible = outline.visible = state.planeOpacity > 0;
    if (plane.visible && state.sweepX !== paintedX) {
      paintedX = state.sweepX;
      paint(planeTex, sliceSamples(Math.min(ROOM[0] - 0.01, Math.max(0.01, state.sweepX)), TW, TH));
    }

    for (const m of markers) {
      m.group.visible = state.ringReveal > 0;
      m.rings.scale.setScalar(lerp(RING_WIDE, m.L * RING_TIGHT, Math.pow(state.converge, 0.6)));
      if (state.flow) m.rings.rotation.z = time * RING_SPIN;
      m.ringMat.opacity = Math.min(1, state.ringReveal * RING_FADE_IN) * lerp(RING_ALPHA[0], RING_ALPHA[1], state.converge);
      m.arrow.scale.setScalar(Math.max(1e-4, easeOutBack(state.settle)));
      m.arrowMat.opacity = m.tipMat.opacity = m.core.material.opacity = state.settle * MARKER_ALPHA;
    }

    // Camera: orbit the room centre at the scroll-driven angles plus the drag offsets.
    stepDrag(drag, dt, state.elevation);  // momentum, friction and the elevation clamp
    const az = state.azimuth + drag.az, el = state.elevation + drag.el;
    // Never closer than the fit (the whole room in the frame): out at once when
    // the room needs more space, in again slowly so the view does not pump.
    const fit = cameraDistance({ aspect: camera.aspect, infer: state.infer, azimuth: az, elevation: el, fovY: FOV, frame: fitFrame });
    distance = easeDistance(distance, fit, dt);
    const dist = distance;
    camera.position.set(
      CENTRE.x + dist * Math.cos(el) * Math.cos(az),
      CENTRE.y + dist * Math.cos(el) * Math.sin(az),
      CENTRE.z + dist * Math.sin(el));
    camera.lookAt(CENTRE);
    // Pan the camera in its own plane (no turn) so the room's centre lands on
    // the frame's centre: exactly the offsets cameraDistance fitted the room to.
    camera.updateMatrixWorld();
    const halfHeight = dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));  // of the view, at the centre
    const [ox, oy] = frameCentre(fitFrame);
    pan.setFromMatrixColumn(camera.matrixWorld, 0);  // view right
    camera.position.addScaledVector(pan, -ox * halfHeight * camera.aspect);
    pan.setFromMatrixColumn(camera.matrixWorld, 1);  // view up
    camera.position.addScaledVector(pan, -oy * halfHeight);

    if (readout) {
      const text = readoutText(p, state, { lit: countLit(readingXs, state.sweepX), total: readingXs.length });
      if (readout.textContent !== text) readout.textContent = text;
    }
  }

  /* ---- Scroll: progress through #sequence --------------------------------- */
  let seqTop = 0, seqHeight = 0;
  // Until the visitor scrolls or drags, any scroll jump (deep link, reload,
  // ?p=) shows its state at once instead of easing through the sequence.
  let snap = true;
  const heroCaption = document.querySelector(".beat-hero .caption");
  const measure = () => {
    seqTop = sequence.getBoundingClientRect().top + window.scrollY;
    seqHeight = sequence.offsetHeight;
    // The caption column's right edge, in device coordinates of the canvas.
    const w = canvas.clientWidth || window.innerWidth;
    const textRight = heroCaption ? (2 * heroCaption.getBoundingClientRect().right) / w - 1 : -1;
    fitFrame = compositionFrame(wide.matches ? "wide" : "stacked", { textRight });
  };
  const readScroll = () => {
    target = progressWithin(window.scrollY, seqTop, seqHeight, window.innerHeight);
    if (snap) progress = target;
  };
  const interacted = () => { snap = false; };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    window.addEventListener(type, interacted, { passive: true, capture: true, signal });
  }
  window.addEventListener("scroll", readScroll, { passive: true, signal });

  // Where the page should start: ?p=, else a saved position on reload or back,
  // else the #hash target. The stage makes the page about four viewports taller
  // than the fallback, so the browser's own jump may have landed in the wrong place.
  const KEY = "antaclis-scroll";
  const debugP = parseFloat(new URLSearchParams(location.search).get("p"));
  if (Number.isFinite(debugP)) time = INTRO_SECONDS;  // a ?p= screenshot shows the particles faded in
  const navType = performance.getEntriesByType?.("navigation")[0]?.type;
  let saved = NaN;
  try {
    if (navType === "reload" || navType === "back_forward") saved = parseFloat(sessionStorage.getItem(KEY));
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.addEventListener("pagehide", () => {
      try { sessionStorage.setItem(KEY, String(window.scrollY)); } catch (_) { /* storage blocked */ }
    }, { signal });
  } catch (_) { /* storage blocked: the browser's own restoration still runs */ }

  const settleScroll = () => {
    if (!snap || life.failed) return;  // the visitor has taken over, or the stage is gone
    measure();
    const instant = { behavior: "instant" };
    if (Number.isFinite(debugP)) {
      window.scrollTo({ top: seqTop + clamp01(debugP) * (seqHeight - window.innerHeight), ...instant });
    } else if (Number.isFinite(saved)) {
      window.scrollTo({ top: saved, ...instant });
    } else if (location.hash.length > 1) {
      let el = null;
      try { el = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (_) { /* bad escape */ }
      if (el) el.scrollIntoView({ block: "start", ...instant });
    }
    readScroll();
    progress = target;
    distance = NaN;
  };
  requestAnimationFrame(settleScroll);  // after the has-stage layout
  if (document.readyState !== "complete") window.addEventListener("load", settleScroll, { once: true, signal });
  document.fonts?.ready.then(settleScroll);

  /* ---- Drag to rotate ------------------------------------------------------ */
  // Pointer events on the canvas; touch-action: pan-y in the CSS leaves vertical
  // swipes to the page, so a vertical swipe cancels the drag (pointercancel).
  let pointer = null;
  if (hint) life.hintTimer = setTimeout(() => { hint.hidden = true; }, HINT_TIMEOUT);
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    dragStart(drag, e.clientX, e.clientY, e.timeStamp / 1000);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    if (hint && !hint.hidden) { hint.hidden = true; clearTimeout(life.hintTimer); }
    wake();
  }, { signal });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId === pointer) dragMove(drag, e.clientX, e.clientY, canvas.clientWidth, e.timeStamp / 1000);
  }, { signal });
  // A release keeps turning only after a fresh flick; a cancel (the page took a
  // vertical swipe) or a lost capture stops the room where it is.
  const release = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    if (e.type === "pointerup") dragEnd(drag, e.timeStamp / 1000);
    else dragCancel(drag);
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, release, { signal });

  /* ---- Size, visibility and the render loop -------------------------------- */
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pointScale.value = (h * ratio) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    measure();  // the frame depends on the canvas width
    dirty = true;
  };
  const relayout = () => { measure(); readScroll(); dirty = true; };
  const observe = (observer, el) => { life.observers.push(observer); observer.observe(el); };
  observe(new ResizeObserver(resize), canvas);
  observe(new ResizeObserver(relayout), sequence);
  window.addEventListener("resize", relayout, { signal });
  wide.addEventListener?.("change", relayout, { signal });
  reducedMotion.addEventListener?.("change", () => { dirty = true; }, { signal });

  // Draw only while the stage is on screen.
  let visible = true, running = false, last = 0;
  observe(new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  }), stage);

  function wake() {
    dirty = true;
    if (running || !visible) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!visible || life.failed) { running = false; return; }
    requestAnimationFrame(frame);
    const dt = last ? Math.min(MAX_DT, (now - last) / 1000) : 0;
    last = now;
    time += dt;

    // Displayed progress eases toward the scroll position so the sweep glides.
    const diff = target - progress;
    if (Math.abs(diff) > 1e-5) progress += diff * Math.min(1, dt * EASE_RATE);
    else progress = target;
    const moving = diff !== 0 || drag.active || drag.vAz !== 0 || drag.vEl !== 0;

    // Under reduced motion nothing moves on its own: skip frames that would not change.
    if (!moving && !dirty && reducedMotion.matches) return;
    dirty = false;
    try {
      apply(progress, dt);
      renderer.render(scene, camera);
    } catch (err) {
      life.fail(err);
    }
  }

  measure();
  resize();
  readScroll();
  // Draw the first frame now, inside start()'s guard: a shader or driver
  // failure falls back before the empty stage is ever painted.
  apply(progress, 0);
  renderer.render(scene, camera);
  wake();
}
