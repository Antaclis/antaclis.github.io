// Writes the text in content.json into site/index.html, in place (the social
// preview image reads content.json itself: tools/og.js). Run from the repo root: `node tools/content.js`.
// Add `--check` to only report whether the files are up to date (exit 1 if not).
//
// How the HTML says where each text goes:
//   - an element with data-text="hero.title" gets that value as its content
//     (escaped; attributes such as id or class are left alone);
//   - a <meta data-text="meta.description" content="..."> gets it as content;
//   - an element with data-href="contact.mailto" gets that value as its href,
//     where the values derived from content.json are
//       contact.mailto          mailto:<email>
//       contact.mailto_subject  mailto:<email>?subject=<subject>
//   - the lists between <!-- CONTENT:topics:START --> ... END and
//     <!-- CONTENT:team:START --> ... END are regenerated from the arrays.
// Everything else in the HTML (structure, classes, the field-line SVG) stays.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONTENT = path.join(ROOT, "content.json");
export const TARGETS = [path.join(ROOT, "site", "index.html")];

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A flat lookup: "hero.title" -> value, plus the derived mailto links.
export function flatten(content) {
  const out = {};
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("_")) continue;  // notes for editors
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key);
      else out[key] = v;
    }
  };
  walk(content, "");
  out["contact.mailto"] = `mailto:${content.contact.email}`;
  out["contact.mailto_subject"] = `mailto:${content.contact.email}?subject=${encodeURIComponent(content.contact.subject)}`;
  return out;
}

// The HTML with content.json's text written in. Throws if the HTML asks for a
// key the content does not have.
export function render(html, content) {
  const values = flatten(content);
  const get = (key) => {
    if (!(key in values)) throw new Error(`content.json has no "${key}" (asked for in the HTML)`);
    return values[key];
  };

  // <meta data-text="..." content="..."> and <title data-text="...">, then any other element.
  html = html.replace(/(<meta\b[^>]*data-text="([^"]+)"[^>]*content=")[^"]*(")/g, (_, pre, key, post) => pre + escape(get(key)) + post);
  html = html.replace(/<(\w+)\b([^>]*data-text="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, attrs, key) => {
    if (tag === "meta") return m;
    return `<${tag}${attrs}>${escape(get(key))}</${tag}>`;
  });
  // data-href: the href attribute, wherever it sits in the tag.
  html = html.replace(/<(\w+)\b([^>]*data-href="([^"]+)"[^>]*)>/g, (m, tag, attrs, key) => {
    const href = escape(get(key));
    return `<${tag}${attrs.replace(/\bhref="[^"]*"/, `href="${href}"`)}>`;
  });

  // Generated lists. Indentation matches the surrounding markup.
  const lists = {
    topics: () => content.work.topics.map((t) => [
      "          <article class=\"topic\">",
      `            <h3>${escape(t.title)}</h3>`,
      `            <p>${escape(t.text)}</p>`,
      "          </article>",
    ].join("\n")).join("\n"),
    team: () => content.team.people.map((p) => [
      "          <li class=\"person\">",
      `            <a href="${escape(p.url)}" target="_blank" rel="noopener noreferrer">${escape(p.name)}<span class="visually-hidden"> ${escape(content.team.link_hint)}</span></a>`,
      `            <p>${escape(p.line)}</p>`,
      "          </li>",
    ].join("\n")).join("\n"),
  };
  for (const [name, build] of Object.entries(lists)) {
    const re = new RegExp(`(<!-- CONTENT:${name}:START -->\\n)[\\s\\S]*?(\\n\\s*<!-- CONTENT:${name}:END -->)`);
    if (re.test(html)) html = html.replace(re, (_, a, b) => a + build() + b);
  }
  return html;
}

export const readContent = () => JSON.parse(readFileSync(CONTENT, "utf8"));

// Renders every target; returns the paths that were (or would be) changed.
export function sync({ write = true } = {}) {
  const content = readContent();
  const changed = [];
  for (const file of TARGETS) {
    const before = readFileSync(file, "utf8");
    const after = render(before, content);
    if (after !== before) {
      changed.push(path.relative(ROOT, file));
      if (write) writeFileSync(file, after);
    }
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const changed = sync({ write: !check });
  if (changed.length === 0) console.log("content: up to date");
  else if (check) { console.error(`content: out of date, run node tools/content.js (${changed.join(", ")})`); process.exit(1); }
  else console.log(`content: wrote ${changed.join(", ")}`);
}
