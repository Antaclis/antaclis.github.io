# Antaclis landing page redesign

Date: 2026-11-06. Status: design, awaiting approval.

Reference prototype: `docs/superpowers/spikes/2026-11-06-scan-prototype.html` (throwaway, approved
in spirit by the team; open it in a browser to see the intended scroll sequence and interaction).
It is not production code and must not be copied into `site/` as is.

## Intent

Antaclis builds custom AI solutions for problems that involve magnetic quantum sensors, using
physics simulation and machine learning to solve inverse problems: from what a sensor reads, back
to what produced it. Antaclis is in its infancy. It has not been founded as a company and has no
public projects yet. The landing page is shown to the first prospective partners, usually after a
conversation or an introduction. Its job is to confirm in under a minute that Antaclis is real,
technically serious and modern, give a concise idea of what it does and how, and hand over the
contact email. It is a card, not a brochure.

The one memorable thing on the page is a scroll-driven simulation of the pitch in motion: a
magnetic field fills a room, a plane scans it and records data, and the data resolves back into
the sources that produced it. Measure, then infer. Everything else on the page is quiet.

## Goals

- A visitor on a laptop or a phone understands within a minute that Antaclis does AI for magnetic
  quantum sensing (simulation plus machine learning for inverse problems) and finds the email.
- The page feels modern and technological and recalls magnetic fields everywhere in its visual
  language.
- The scroll simulation runs smoothly on an ordinary laptop and a recent phone, and the page still
  reads well where it cannot run.
- The site lives at antaclis.com, served by GitHub Pages from the existing repository.

## Non-goals

- Describing projects, results, partners or hardware. Nothing project-specific appears anywhere.
- A blog, news, multiple pages, forms, analytics, cookies or any third-party service at runtime.
- Light mode. The page is dark only (see Visual system).

## Anti-goals (what would make this a failure even if it works)

- Calling Antaclis a company, a startup, a spin-off or a project, or naming founders or a legal
  status. It is just "Antaclis". No "we are a company that...", no "not yet registered".
- Explaining the two-magnet example as a project or a result. On the page it is an illustration
  of the method, never "our work on magnets in rooms".
- A page that reads as a generic AI startup template: hero with a gradient blob, three feature
  cards with icons, numbered "01 / 02 / 03" sections, "→" after every link.
- Making the simulation the whole page. The text must stand on its own if the WebGL stage is
  blank.

## Constraints

- Static site, no build step: `site/` is uploaded as is by `.github/workflows/deploy.yml`.
- No runtime dependency on a CDN. Any library is vendored under `site/vendor/` with its licence
  file beside it, as the fonts already are. Nothing is fetched from a third party.
- Keep the existing header assets, favicons, Open Graph image pipeline (`tools/brand.py`,
  `tools/og.html`) and the generated static field-line SVG (`tools/fieldlines.py`) working; update
  them where the design changes their content (tagline, domain).
- Accessibility floor: semantic headings, skip link, visible keyboard focus, `prefers-reduced-motion`
  respected, text contrast at least 4.5:1 on the dark background, the simulation marked
  decorative to assistive technology and its story carried by the visible captions.
- Page weight target: under 1 MB transferred on first load including the 3D library and fonts.

## Content and structure

One page, in this order. Section names are the visible headings, in sentence case.

### Header

Logo mark (existing `site/assets/logo-mark-dark.png`) and the wordmark "Antaclis". Navigation:
"What we do", "Team", "Contact", as in-page links. On small phones the first link may be hidden,
as now.

### Hero and scroll sequence

The WebGL stage is fixed behind the content for the first part of the page (roughly four to five
viewport heights of scrolling) and the captions scroll past it in a single left-aligned column.
After the sequence ends, the page continues as a normal scrolling page and the stage scrolls away
with it (it must not stay fixed behind the team and contact sections).

Beats of the sequence, each a caption that the visitor scrolls past while the stage changes:

1. Hero. Wordmark, the headline, a one-sentence lead. Stage: the field lines of two hidden sources
   draw in and pulse. No sources visible.
2. Measure. Stage: a translucent plane sweeps across the room, showing the field strength on its
   surface as a colour map and leaving a recorded slice behind at each position; the field lines
   fade behind it, so by the end of the sweep only the data remains.
3. Infer. Stage: the slices dissolve from the walls inward; at each source an uncertainty sphere
   (three faint rings) appears wide and tightens as the inference converges; then a thin arrow
   along each source's moment and a small glowing core fade in, and the field lines come back
   around them. The sources are drawn as results of an inference, never as cartoon magnets.
4. Landing. The last caption states what Antaclis does, and the page then continues to "What we
   do". The stage holds its final state here.

A small monospace readout in the corner of the stage reports the scan position and slice count in
real units during the sweep (as in the prototype). Keep it: it is the one detail that says this is
a real simulation and not a video.

Interaction: dragging on the stage rotates the room about its centre in azimuth and elevation. A
flick gives it momentum that friction stops after a few seconds; the view stays where it ends up
and the scroll-driven orbit continues from there. Elevation is clamped so the camera never flips.
On touch screens, vertical swipes scroll the page and horizontal swipes rotate (`touch-action:
pan-y`). Text blocks remain selectable and clickable; drags elsewhere reach the stage.

### What we do

A single statement, then the four things Antaclis works with, as a plain two-by-two grid of short
titled paragraphs (not cards, not numbered, no icons):

- Quantum sensors
- Physics simulation
- Machine learning
- Inverse problems

### Team

Kept. Four people, alphabetical by surname, name linking to LinkedIn, one line each. Same format
as now; each person approves their own line. No photos.

### Contact

A short invitation and the email address, `contact@antaclis.com`, both as a mailto button and as
visible selectable text. No form.

### Footer

"© 2026 Antaclis". Nothing about legal status.

## Copy

Draft for review by the team (the first prototype's captions were not liked; this draft is
shorter and less explanatory). The builder uses this copy unless the team replaces it.

- Title tag: "Antaclis · Seeing through fields"
- Meta description and Open Graph description: "Antaclis builds AI for magnetic quantum sensing:
  simulation and machine learning that turn sensor readings into answers."
- Hero headline: "Seeing through fields." (kept from the current site; it is already on the Open
  Graph image and fits the sequence)
- Hero lead: "AI for magnetic quantum sensing. Simulation and machine learning that turn what a
  sensor reads into what produced it."
- Beat 2, heading: "Measure." Line: "A quantum magnetometer records the field, plane by plane."
- Beat 3, heading: "Infer." Line: "Simulation and machine learning trace the data back to its
  sources: where they are, how strong, which way they point."
- Beat 4, heading: "That is Antaclis." Line: "Custom AI for problems built around magnetic quantum
  sensors."
- What we do, statement: "Custom AI solutions for problems built around magnetic quantum sensors."
  - Quantum sensors: "Quantum magnetometers, modelled down to their noise, drift and limits."
  - Physics simulation: "Differentiable simulations of fields, sources and sensors, fast enough to
    run many thousands of times."
  - Machine learning: "Models trained on simulated data and calibrated against real measurements."
  - Inverse problems: "From readings back to causes, with uncertainties rather than a single
    best guess."
- Contact, statement: "Working on something that involves magnetic sensors? Write to us."
  Button: "Write to contact@antaclis.com" (or "Get in touch" with the address beside it).

Style: plain declarative sentences, sentence case, no em-dashes, no exclamation marks, no arrows
in link text, British spelling as in the team's documents.

## Visual system

Dark only, by choice: the brand is navy, the simulation is a night-sky field, and a single theme
keeps the page and the stage coherent. The `prefers-color-scheme: light` overrides and the
`color-scheme` meta are removed; `theme-color` is the navy.

- Background: `#0D0F22` (navy from the logo), with the stage drawn directly on it.
- Text: `#E8EAF2`; muted text `#A2A8C0`; hairlines `rgba(232,234,242,0.12)`.
- Accent: `#8AB6F9` (logo blue), used for field lines, the readout numbers, focus rings and the
  button. It is the only accent.
- Field data ramp (the colour map on the scanning plane and slices): transparent navy, then
  `#3458C8`, then `#8AB6F9`, then `#DCE9FF` (near white at the strongest field). The ramp is log
  scaled in field strength with its window set from the data, as in the prototype.
- Inferred-source markers: rings in the accent, arrow and core in `#DCE9FF`.

Typography (my call; the team may swap the family): one text family with a wide weight range for
headline and body, self-hosted under an open licence, chosen for a precise technical feel rather
than the default Inter (which the current site uses): Schibsted Grotesk, or Hanken Grotesk if the
former is unavailable as a variable font. IBM Plex Mono stays for the readout, the email address
and small labels. Headline weight 500, letter-spacing slightly negative, line-height close to 1.
Body 17 px, line length under 70 characters. Section headings in sentence case, no uppercase
eyebrows, no numbers.

Layout: one left-aligned column for all text (max width about 30 rem for captions, 44 rem for
statements), generous vertical space between sections, hairline rules between sections aligned to
the text column as now. Content left aligned throughout; nothing centred except on phones where
the column fills the width.

Motion: one orchestrated piece, the scroll sequence. No fade-in-on-scroll for sections, no hover
transitions beyond colour. The stage has a subtle ambient life while idle (pulses travelling along
field lines, a very slow camera drift), which is turned off under `prefers-reduced-motion`; the
scroll-driven changes and the drag rotation remain, since the visitor drives them.

## The simulation (what the builder implements)

The stage renders in WebGL. Physics and geometry follow the prototype:

- Room 500 x 500 x 300 cm. Two point dipoles: 1 cm³ of N52 at (150, 350, 60) cm pointing up
  (moment 1.15 A m²), and 8 cm³ at (350, 150, 150) cm with moment 9.2 A m² along the unit vector
  of (1, -1, 0.5). Field of a dipole up to a constant: (3 r (m·r) / r² - m) / r³.
- Field lines: seeds on a 12 cm sphere around each dipole at polar angles 12°, 18°, 26° and 40°
  from the moment, 8 azimuths each; traced along +B with RK4, 2 cm steps, at most 900 steps,
  stopping within 9 cm of any dipole or at the walls. Computed in the browser at load (it takes
  milliseconds), never shipped as data.
- Slices: 28 planes of constant x; each a 96 x 58 texture of log field magnitude through the
  colour ramp, alpha growing with field strength so weak regions stay transparent. The scanning
  plane carries a live texture at its current x plus a bright outline.
- Scroll mapping (fraction p of the sequence): lines draw in over 0 to 0.16; sweep from
  x = -70 to 570 cm over 0.16 to 0.62; hold over 0.62 to 0.72; inference over 0.72 to 1 with the
  stagger used in the prototype (slices dissolve from the walls inward, rings appear, tighten,
  arrow and core settle). Progress eases toward the scroll position so the sweep glides.
- Camera: perspective, up axis z, orbiting the room centre; azimuth drifts from -0.55 to 0.45 rad
  across the sequence; elevation 0.40 to 0.30 rad; distance chosen so the room fits at any aspect
  ratio. Drag and momentum as described under Interaction.
- Rendering runs only while the stage is on screen; pixel ratio capped at 2.

Library: three.js, one pinned release, vendored under `site/vendor/` with its MIT licence. The
prototype uses r128 (UMD build); the builder may use a newer release with ES modules. A hand-written
WebGL renderer is acceptable instead if the builder prefers it; the visual result is what is
specified, not the library.

Fallbacks:

- No WebGL, or JavaScript disabled: the stage is replaced by the existing static field-line SVG
  in the hero (regenerate it with `tools/fieldlines.py` if the hero layout changes) and the
  captions read as ordinary sections. The readout is hidden.
- `prefers-reduced-motion`: ambient pulses and camera drift off; scroll and drag still work.
- Small phones: the stage fills the viewport behind the column; the drag hint is omitted; the
  readout shrinks or hides below about 360 px width.

## Domain and deployment

- Add `site/CNAME` containing `antaclis.com`. GitHub Pages then serves the custom domain and
  redirects `antaclis.github.io` to it once DNS is set (A records to GitHub's four Pages IPs and
  a `www` CNAME to `antaclis.github.io`; the team does this at the registrar, and enables
  "Enforce HTTPS" in the repository's Pages settings after the certificate is issued).
- Canonical URL, Open Graph URL and image URL, and the twitter card use `https://antaclis.com/`.
- Email everywhere: `contact@antaclis.com`. The old Gmail address is removed.
- Regenerate `site/assets/og.png` from `tools/og.html` with the new lead line.

## Left to the builder

- Exact section spacing, type scale values, slice count and texture resolution if performance
  needs it, the easing curves, and how the sequence hands over to the normal page flow.
- The structure of the JavaScript (one file or several under `site/`), as long as it is readable
  and commented in the spirit of the current `field.js`.
- Whether to keep `field.js` (the single-dipole hero animation) for the no-WebGL fallback or
  retire it in favour of the static SVG only.
- Font files and subsetting, following `site/fonts/` conventions.

## Decisions made during the brainstorm

- Address: `contact@antaclis.com` (not `info@`), with `info@` as a forwarding alias set up by the
  team but never printed.
- Sources are shown as inferred results (rings, arrow, core), not as bar magnets.
- Drag rotation has momentum and friction and does not return to the origin.
- The team section stays.
- The page stays a dependency-free static site with the simulation computed in the browser.
