# tools

Helper scripts for the website. Nothing here is published; GitHub Pages only serves `site/`.
The Python tools need `numpy` and `Pillow`. One way to get them without installing anything globally is `uv run --with numpy --with pillow python tools/<script>.py`. The Node tools need `npm install` once (the only package is the SVG rasteriser for the social preview image). Run everything from the repo root.

| Script | What it does |
| --- | --- |
| `node tools/content.js` | Writes every piece of page text from `content.json` (repo root) into `site/index.html`. Edit the JSON, run this, done; `--check` only reports. `npm test` fails while the HTML and the JSON disagree. The deploy workflow runs this before testing and publishing, so editing `content.json` on `main` is enough to update the site; committing the rendered HTML as well keeps the repo readable. In the HTML, `data-text="key"` marks where a text goes, `data-href="key"` a link, and the `CONTENT:topics` and `CONTENT:team` markers wrap the two generated lists. |
| `python tools/brand.py` | Builds the logo variants and favicons in `site/assets/` (plus `site/favicon.ico`) from `a-logo-white.png`. |
| `python tools/fieldlines.py` | Computes the hero field lines and writes them into `site/index.html` between the `FIELD-LINES` markers (the social preview image picks them up from there). To change the drawing, edit `DIPOLES` and `LOOPS` at the top of the script. |
| `site/stage/model.js`, `sequence.js`, `stage.js` (not tools, but related) | The live hero stage. `model.js` is the field physics, `sequence.js` turns scroll, time and drag into state and fits the camera, `stage.js` is the three.js scene. Two debug hooks on the page URL: `?p=<0..1>` jumps to a position in the sequence, and `?nowebgl=1` forces the static fallback. |
| `npm test` | Runs the unit and content tests in `tests/` with `node --test`. |
| `node tools/og.js` | Draws the social preview image: writes `tools/og.svg` (the picture, from `content.json`, the field lines and the logo mark) and rasterises it to `site/assets/og.png` (1200×630) with `@resvg/resvg-js`, so the result is identical on every machine and needs no browser. Layout constants sit at the top of the script. |
| `tools/fonts/` | Static TTF instances of Schibsted Grotesk at weights 500 and 600, made from `site/fonts/schibsted-grotesk-latin-wght.woff2` for `og.js` (SVG rasterisers read TTF only). Same licence as the woff2, `site/fonts/LICENSE-Schibsted-Grotesk.txt`. To remake them after a font change: |

```sh
uv run --with fonttools --with brotli python - <<'EOF'
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
for w, sub in ((500, "Medium"), (600, "SemiBold")):
    f = TTFont("site/fonts/schibsted-grotesk-latin-wght.woff2"); f.flavor = None
    inst = instantiateVariableFont(f, {"wght": w})
    inst["OS/2"].usWeightClass = w
    name = inst["name"]
    for nid in (1, 2, 3, 4, 6, 16, 17): name.removeNames(nameID=nid)
    for nid, val in ((1, "Schibsted Grotesk"), (2, sub), (3, f"SchibstedGrotesk-{sub};latin;instanced"), (4, f"Schibsted Grotesk {sub}"), (6, f"SchibstedGrotesk-{sub}")):
        name.setName(val, nid, 3, 1, 0x409)
    inst.save(f"tools/fonts/schibsted-grotesk-latin-{w}.ttf")
EOF
```
