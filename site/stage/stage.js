/* ==========================================================================
   Antaclis, the scroll-driven field scan behind the opening captions

   Two hidden magnets fill a 5 x 5 x 3 m room with field lines. As the visitor
   scrolls through #sequence:
     - the field lines draw in and faint pulses travel along them;
     - a plane sweeps the room, showing the field strength on its surface and
       leaving a recorded slice behind it, while the lines behind it fade;
     - the slices dissolve from the walls inward, an uncertainty sphere (three
       rings) appears at each source and tightens, then an arrow along each
       moment and a glowing core settle, and the field lines come back.
   Dragging rotates the room; a flick keeps it turning until friction stops it.

   This file only draws. The physics (field, lines, slices) is in model.js and
   everything that depends on scroll, time or drag (stage boundaries, sweep,
   slice timing, camera path and distance easing, drag law and flick window)
   is in sequence.js; both are tested in Node. Constants here are visual only
   (colours, sizes, opacities, layout), plus the three UI timings the brief
   fixes: scroll easing rate, frame-step cap and drag-hint timeout.

   The page works without this script: unless WebGL starts, <html> never gets
   the class has-stage, the stage stays hidden and the static SVG stays. If
   start-up fails after that (a shader or driver problem), start() takes the
   class away again and the static SVG comes back.
   Debug: ?nowebgl=1 forces that fallback; ?p=0.45 jumps to progress 0.45
   (with the load-time draw-in already finished).
   ========================================================================== */
import * as THREE from "../vendor/three.module.min.js";
import { ROOM, DIPOLES, traceFieldLines, sliceSamples, logWindow } from "./model.js";
import {
  SLICE_X, SLICE_RES, INTRO_SECONDS, sequenceState, colourRamp, cameraDistance, compositionFrame, frameCentre, progressWithin,
  createDrag, dragStart, dragMove, dragEnd, dragCancel, stepDrag, easeDistance, readoutText,
} from "./sequence.js";

/* ---- Visual constants ---------------------------------------------------- */
const ACCENT = 0x8ab6f9;     // field lines, rings, room edges
const GLOW = 0xdce9ff;       // plane outline, arrows, cores
const FOV = 38;              // degrees, vertical
const LINE_ALPHA = 0.75;     // field-line opacity at full strength
const EDGE_ALPHA = 0.10;     // room edges
const OUTLINE_ALPHA = 0.8;   // scanning-plane outline, relative to the plane
const MARKER_ALPHA = 0.95;   // arrows and cores once settled
const ARROW_SIZE = 26;       // cm, arrow length of the smaller source (others scale with |m|^(1/3))
const RING_WIDE = 110;       // cm, uncertainty-sphere radius when the rings appear
const RING_TIGHT = 0.28;     // final radius, as a fraction of the arrow length
const RING_SPIN = 0.12;      // rad/s, slow ambient turn of the rings
const RING_ALPHA = [0.45, 0.85];  // ring opacity while wide, and once tightened
const RING_FADE_IN = 2.5;    // rings reach full opacity at 40% of their reveal
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
  // values, textures and the custom shader all stay in sRGB, blended as is.
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

  // Draw order of the transparent layers, back to front: the field lines stay
  // crisp over the data (the shader already dims those behind the plane) and the
  // markers sit on top of everything. Within a layer three.js sorts by depth.
  const LAYER = { edges: 0, slices: 1, plane: 2, lines: 3, markers: 4 };

  /* ---- Room edges -------------------------------------------------------- */
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM[0], ROOM[1], ROOM[2])),
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: EDGE_ALPHA, depthWrite: false }),
  );
  edges.position.copy(CENTRE);
  edges.renderOrder = LAYER.edges;
  scene.add(edges);

  /* ---- Field lines: one LineSegments, drawn by a small shader --------------
     aT is the position along the line (0 to 1) and aPh a per-line phase. The
     fragment shader draws each line in from its seed as uDraw grows (lines
     start at staggered moments), dims everything behind the scanning plane
     (x < uSweep) until uRestore brings it back, tapers the ends, and adds
     pulses that travel along the lines (uPulse = 0 under reduced motion). */
  const lineUniforms = {
    uDraw: { value: 0 }, uSweep: { value: 0 }, uRestore: { value: 0 }, uPulse: { value: 1 },
    uAlpha: { value: LINE_ALPHA }, uTime: { value: 0 }, uColor: { value: new THREE.Color(ACCENT) },
  };
  {
    const lines = traceFieldLines();
    let segments = 0;
    for (const pts of lines) segments += pts.length / 3 - 1;
    const pos = new Float32Array(segments * 6), aT = new Float32Array(segments * 2), aPh = new Float32Array(segments * 2);
    let s = 0;
    lines.forEach((pts, li) => {
      const n = pts.length / 3, ph = (li * 0.618) % 1;
      for (let i = 0; i < n - 1; i++, s++) {
        pos.set(pts.subarray(3 * i, 3 * i + 6), 6 * s);
        aT[2 * s] = i / (n - 1); aT[2 * s + 1] = (i + 1) / (n - 1);
        aPh[2 * s] = aPh[2 * s + 1] = ph;
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    geometry.setAttribute("aPh", new THREE.BufferAttribute(aPh, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: lineUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute float aPh;
        varying float vT;
        varying float vPh;
        varying float vX;
        void main() {
          vT = aT; vPh = aPh; vX = position.x;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uDraw, uSweep, uRestore, uPulse, uAlpha, uTime;
        uniform vec3 uColor;
        varying float vT;
        varying float vPh;
        varying float vX;
        void main() {
          float d = uDraw * 1.3 - vPh * 0.3;
          float drawn = 1.0 - smoothstep(d - 0.04, d, vT);
          float ahead = smoothstep(uSweep - 40.0, uSweep + 10.0, vX);
          float keep = max(mix(0.10, 1.0, ahead), uRestore);
          float taper = smoothstep(0.0, 0.03, vT) * (1.0 - smoothstep(0.97, 1.0, vT));
          float pulse = 0.5 + 0.5 * sin(vT * 28.0 - uTime * 1.6 + vPh * 6.2832);
          float shine = mix(0.8, 0.7 + 0.5 * pow(pulse, 6.0), uPulse);
          gl_FragColor = vec4(uColor, uAlpha * drawn * keep * taper * shine);
        }`,
    });
    const fieldLines = new THREE.LineSegments(geometry, material);
    fieldLines.renderOrder = LAYER.lines;
    scene.add(fieldLines);
  }

  /* ---- Slices: planes of constant x, coloured by log |B| ------------------- */
  const [TW, TH] = SLICE_RES;
  const recorded = SLICE_X.map((x) => sliceSamples(x, TW, TH));
  // Colour window from all recorded readings together, so slices compare.
  const all = new Float32Array(recorded.length * TW * TH);
  recorded.forEach((s, i) => all.set(s, i * TW * TH));
  const win = logWindow(all);

  const makeTexture = () => {
    const tex = new THREE.DataTexture(new Uint8Array(TW * TH * 4), TW, TH, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    return tex;
  };
  // Row j of the samples is height z, column i is y; texel (i, j) maps to uv (i, j).
  const paint = (tex, samples) => {
    const data = tex.image.data;
    for (let k = 0; k < samples.length; k++) data.set(colourRamp((samples[k] - win.lo) / (win.hi - win.lo)), 4 * k);
    tex.needsUpdate = true;
  };
  // A quad spanning the room's y-z cross-section at x, with uv along y and z.
  const sliceGeometry = (x) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([x, 0, 0, x, ROOM[1], 0, x, ROOM[1], ROOM[2], x, 0, ROOM[2]], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  };
  const sliceMaterial = (map) =>
    new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

  const slices = SLICE_X.map((x, i) => {
    const tex = makeTexture();
    paint(tex, recorded[i]);
    const mesh = new THREE.Mesh(sliceGeometry(x), sliceMaterial(tex));
    mesh.visible = false;
    mesh.renderOrder = LAYER.slices;
    scene.add(mesh);
    return mesh;
  });

  // The scanning plane: a live texture of the field at its current x, plus an outline.
  const planeTex = makeTexture();
  const plane = new THREE.Mesh(sliceGeometry(0), sliceMaterial(planeTex));
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
    lineUniforms.uSweep.value = state.sweepX;
    lineUniforms.uRestore.value = state.restore;
    lineUniforms.uPulse.value = state.pulsesOn ? 1 : 0;
    lineUniforms.uTime.value = time;

    plane.position.x = outline.position.x = state.sweepX;
    plane.material.opacity = state.planeOpacity;
    outline.material.opacity = state.planeOpacity * OUTLINE_ALPHA;
    plane.visible = outline.visible = state.planeOpacity > 0;
    if (plane.visible && state.sweepX !== paintedX) {
      paintedX = state.sweepX;
      paint(planeTex, sliceSamples(Math.min(ROOM[0] - 0.01, Math.max(0.01, state.sweepX)), TW, TH));
    }

    slices.forEach((mesh, i) => {
      mesh.material.opacity = state.sliceOpacity[i];
      mesh.visible = state.sliceOpacity[i] > 0.002;
    });

    for (const m of markers) {
      m.group.visible = state.ringReveal > 0;
      m.rings.scale.setScalar(lerp(RING_WIDE, m.L * RING_TIGHT, Math.pow(state.converge, 0.6)));
      if (state.pulsesOn) m.rings.rotation.z = time * RING_SPIN;
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
      const text = readoutText(p, state);
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
  if (Number.isFinite(debugP)) time = INTRO_SECONDS;  // a ?p= screenshot shows the lines drawn
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
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
