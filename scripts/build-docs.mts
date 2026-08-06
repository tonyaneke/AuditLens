/* Build the deployed copies of the AuditLens manuals into public/docs/.
 *
 *   AuditLens-User-Manual.html  ──┬─→  public/docs/user-manual.html          (the whole thing)
 *   docs/action-owner-manual.body.html ─→  public/docs/action-owner-manual.html
 *
 * The root manual stays the single source of truth for the shared CSS, the embedded typeface and
 * the figures: the action-owner manual is only a body of <section class="sheet"> blocks with
 * {{FIG:n}} placeholders, and this script gives it the same shell, rail, cover and contents.
 * Re-run it whenever either source changes:  npx tsx scripts/build-docs.mts
 *
 * WHY THE WEB COPIES ARE NOT JUST THE FILE COPIED IN — three things have to change:
 *
 *  1. NO SCRIPT MAY RUN.  proxy.ts serves `script-src 'self' 'nonce-…' 'strict-dynamic'`. Under
 *     'strict-dynamic' the host allowlist is ignored, so a static file cannot run an inline
 *     script OR an external one — neither can carry the per-request nonce. The source manual's
 *     scroll-spy and its onclick="window.print()" are therefore stripped rather than moved to a
 *     .js file, which would simply be blocked. Nothing else on the page needed JavaScript.
 *
 *  2. THE TYPEFACE MOVES OUT OF THE CSS.  The manual embeds Jakarta as a data: URL, and the CSP
 *     sets `font-src 'self'` — which does NOT cover data:. Left inline the font is blocked and the
 *     document silently falls back to system-ui. It is written to public/docs/assets/ and
 *     referenced relatively instead, so the policy does not have to be widened.
 *     The figures stay inline: `img-src` already allows data:, AND — the reason this matters —
 *     proxy.ts's matcher EXCLUDES .png/.jpg/.jpeg/… from authentication. Extracting the figures
 *     to files would publish screenshots of real observations, names and email addresses to
 *     anyone with the URL, INCLUDING those in user-manual.html, which is the one document here
 *     that still requires a session (see PUBLIC_PATHS in proxy.ts — the owner guide is public, the
 *     full manual is not, because only the full manual embeds the user directory). Inline, each
 *     document's figures inherit that document's access rule instead of escaping it.
 *
 *  3. IT HAS TO BE A REAL DOCUMENT.  The source has no <!doctype>, no <html lang>, and — the one
 *     that actually breaks phones — no <meta name="viewport">. Without it a mobile browser lays
 *     the page out at 980px and scales it down, so every one of the manual's media queries is
 *     dead on the device they were written for.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "AuditLens-User-Manual.html");
const OWNER_BODY = join(ROOT, "docs", "action-owner-manual.body.html");
const OUT_DIR = join(ROOT, "public", "docs");
const ASSET_DIR = join(OUT_DIR, "assets");
const FONT_FILE = "assets/manual-jakarta.woff2";

const ORG = "Nigerian Consumer Credit Corporation (CREDICORP)";
const DOC_DATE = "31 July 2026";

/* ---------------------------------------------------------------- web overrides */

/* Appended after the source manual's own <style>, so it wins on equal specificity.
   Everything here exists because the source is a PRINT document being put on a screen. */
const WEB_CSS = `
/* ================= web build — appended by scripts/build-docs.mts ================= */

/* FULL WIDTH. The print layout centres a 1500px shell and caps every block of prose at a 74ch
   measure, which on a wide screen leaves the right-hand third of each sheet empty. On the web the
   document uses the width it is given: the shell loses its cap, and the measure becomes the
   column itself.

   Scoped to screen, and NOT written into the print block below — on A4 the 74ch measure is
   correct and is what the source document was set to, so Ctrl+P still produces the original
   typography rather than lines running the full width of the paper. */
@media screen{
  .shell{max-width:none}
  :root{--measure:100%}
}
@media screen and (min-width:1120px){
  .shell{padding:0 var(--s4) 0 var(--s3);gap:var(--s4)}
}
@media screen and (min-width:1700px){
  .shell{grid-template-columns:300px minmax(0,1fr)}
}
/* Figures are raster screenshots ~1150-1300px wide; stretching them past that only blurs them. */
.fig{max-width:min(100%,1280px)}

/* MOBILE. The rail is desktop-only, so below 1120px the contents sheet is the only way back to
   the top level — give it a permanent, JS-free way in. */
.doc-jump{
  position:fixed;right:.75rem;bottom:.75rem;z-index:20;
  display:inline-flex;align-items:center;gap:.4rem;
  padding:.55rem .85rem;border-radius:999px;
  background:var(--pine);color:#fff;text-decoration:none;
  font-size:.8rem;font-weight:600;letter-spacing:-.01em;
  box-shadow:0 2px 6px rgba(10,74,59,.25),0 10px 24px -10px rgba(10,74,59,.5);
}
.doc-jump:hover{background:var(--jade)}
@media (min-width:1120px){.doc-jump{display:none}}
@media print{.doc-jump{display:none!important}}

/* Small phones: the sheets keep a hairline of ground either side rather than going edge to edge,
   but the padding inside them comes down so the text column is not squeezed. */
@media (max-width:520px){
  .doc{padding:var(--s3) .55rem var(--s5);gap:var(--s3)}
  .sheet{padding:var(--s3) .85rem var(--s4);border-radius:2px}
  .band{font-size:.58rem}
  body{font-size:14.5px}
  .cover{padding:var(--s4) 1rem var(--s4)}
  .cover-meta{grid-template-columns:1fr 1fr}
  .figcap{font-size:.78rem}
  .toc a .tt{flex:none}
  .toc a .tl{min-width:1rem}
}
/* A wide table cannot reflow, so it scrolls inside its own frame (.tw already does that). Without
   a cue it just looks cut off, so the frame carries scroll shadows: two "cover" gradients pinned to
   the content (background-attachment:local) sit over two shadows pinned to the frame, so a shadow
   is only visible on a side there is more table to reach. An absolutely-positioned overlay cannot
   do this — .tw IS the scroll container, so the overlay would scroll away with the content. */
.tw{
  -webkit-overflow-scrolling:touch;
  background:
    linear-gradient(to right, var(--paper) 40%, transparent) left center / 34px 100% no-repeat local,
    linear-gradient(to left,  var(--paper) 40%, transparent) right center / 34px 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%,   rgba(10,74,59,.20), rgba(10,74,59,0)) left center / 12px 100% no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%,rgba(10,74,59,.20), rgba(10,74,59,0)) right center / 12px 100% no-repeat scroll;
}
/* On a phone the frame is ~340px against a 520px table, so pull the table itself in as far as it
   will go before falling back on the scroll. */
@media (max-width:560px){
  table{min-width:430px;font-size:.82rem}
  thead th{padding:.5rem .55rem;font-size:.62rem;letter-spacing:.08em}
  tbody td,tbody th{padding:.5rem .55rem}
  .rate{padding:.5rem .55rem;font-size:.74rem}
}
/* Long unbroken strings (URLs, ids) must not push the page sideways on a phone. */
.p,.bul li,.steps li,td,th{overflow-wrap:break-word}

/* NO JAVASCRIPT (see the header of scripts/build-docs.mts). The rail's print button is replaced
   by the keyboard shortcut, and the scroll-spy that lit the current section is gone — so give the
   rail a hover/focus affordance and let :target carry the "you are here" cue instead. */
.rail-print-hint{
  margin-top:var(--s3);padding:.5rem .7rem;font-size:.72rem;line-height:1.55;
  color:var(--muted);border:1px dashed var(--rule);border-radius:7px;text-align:center;
}
.rail-print-hint kbd{font-size:.72rem}
.sheet:target{outline:2px solid var(--jade);outline-offset:3px}
@media print{.sheet:target{outline:none}}

/* The web copy is read on a screen, so it scrolls continuously — the per-section page break the
   print stylesheet adds is still right for Ctrl+P and is left alone. */
`;

/* ---------------------------------------------------------------- helpers */

function slice(src: string, startMark: string, endMark: string, what: string): string {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error(`build-docs: could not find the start of ${what} (${startMark})`);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error(`build-docs: could not find the end of ${what} (${endMark})`);
  return src.slice(a + startMark.length, b);
}

/** Every figure in the source manual, in document order, as full `data:` URLs. */
function figures(src: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]*src="(data:image\/(?:jpeg|png);base64,[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** Pull the @font-face data: URL out to a real file and point the CSS at it. */
function externaliseFont(css: string): string {
  const m = css.match(/src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/);
  if (!m) {
    console.warn("build-docs: no embedded woff2 found — leaving the font rule alone");
    return css;
  }
  mkdirSync(ASSET_DIR, { recursive: true });
  const bytes = Buffer.from(m[1], "base64");
  writeFileSync(join(OUT_DIR, FONT_FILE), bytes);
  console.log(`  assets: ${FONT_FILE}  ${Math.round(bytes.length / 1024)} kB`);
  return css.replace(m[0], `src:url("${FONT_FILE}") format("woff2")`);
}

/** Strip everything the CSP would refuse to run, and replace the print button with its shortcut. */
function deJavaScript(html: string): string {
  let out = html.replace(
    /<button class="rail-print"[^>]*>[\s\S]*?<\/button>/,
    `<div class="rail-print-hint">Press <kbd>Ctrl</kbd>+<kbd>P</kbd><br>to print or save as PDF</div>`,
  );
  out = out.replace(/<script\b[\s\S]*?<\/script>/g, "");
  out = out.replace(/\son\w+="[^"]*"/g, "");
  return out;
}

function page({
  title,
  css,
  body,
  jumpTo,
}: {
  title: string;
  css: string;
  body: string;
  jumpTo: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>${css}
${WEB_CSS}</style>
</head>
<body>
${body}
<a class="doc-jump" href="#${jumpTo}">&#8593; Contents</a>
</body>
</html>
`;
}

/* Headings are lifted out of the owner body as HTML and put back as HTML, so they arrive already
   escaped — running esc() straight over "Responding &amp; Closing" would render it as
   "Responding &amp; Closing" in the rail. Decode first, then escape, so the round trip is lossless
   whichever form the source used. &amp; is decoded last: doing it first would turn "&amp;lt;" into
   a real "<". */
function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function esc(s: string): string {
  return unesc(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------------------------------------------------------------- owner manual assembly */

type Sub = { id: string; num: string; title: string };
type Sec = { id: string; num: string; title: string; subs: Sub[] };

/** Read the owner body's own headings so its rail and contents sheet are never out of step. */
function outlineOf(body: string): Sec[] {
  const secs: Sec[] = [];
  const secRe = /<section class="sheet"[^>]*id="(s\d+)"[\s\S]*?(?=<section class="sheet"|$)/g;
  let m: RegExpExecArray | null;
  while ((m = secRe.exec(body))) {
    const block = m[0];
    const id = m[1];
    const h2 = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const num = block.match(/<div class="sec-num">\s*Section\s+(\d+)/i);
    const subs: Sub[] = [];
    const subRe = /<h3[^>]*id="([^"]+)"[^>]*>\s*<span class="n">([^<]*)<\/span>([\s\S]*?)<\/h3>/g;
    let s: RegExpExecArray | null;
    while ((s = subRe.exec(block))) {
      subs.push({
        id: s[1],
        num: s[2].trim(),
        title: s[3].replace(/<[^>]+>/g, "").trim(),
      });
    }
    secs.push({
      id,
      num: num ? num[1] : id.replace(/\D/g, ""),
      title: h2 ? h2[1].replace(/<[^>]+>/g, "").trim() : id,
      subs,
    });
  }
  return secs;
}

function ownerRail(secs: Sec[]): string {
  const links = secs
    .map((s) => `    <a href="#${s.id}"><span>${s.num}</span><span>${esc(s.title)}</span></a>`)
    .join("\n");
  return `<aside class="rail">
  <div class="rail-mark"><i class="mark" aria-hidden="true"></i><b>AuditLens</b></div>
  <div class="rail-eyebrow">Contents</div>
  <nav id="rail">
    <a href="#cover"><span>&#9679;</span><span>Cover</span></a>
${links}
  </nav>
  <div class="rail-print-hint">Press <kbd>Ctrl</kbd>+<kbd>P</kbd><br>to print or save as PDF</div>
</aside>`;
}

function ownerFrontMatter(secs: Sec[]): string {
  const rows = secs
    .map((s) => {
      const top = `    <a href="#${s.id}"><span class="tn">${s.num}</span><span class="tt">${esc(s.title)}</span><span class="tl"></span><span class="tp">${s.num}</span></a>`;
      const kids = s.subs
        .map(
          (k) =>
            `    <a href="#${k.id}" class="i2"><span class="tn">${k.num}</span><span class="tt">${esc(k.title)}</span><span class="tl"></span><span class="tp">${s.num}</span></a>`,
        )
        .join("\n");
      return kids ? `${top}\n${kids}` : top;
    })
    .join("\n\n");

  return `<section class="sheet" id="toc">
  <div class="band"><span>Document Classification – Internal</span><span class="folio">i</span></div>

  <div class="sec-head">
    <h2>Table of Contents</h2>
    <p class="sec-lede">This manual covers everything an action owner does in AuditLens. It does not
    describe the parts of the system reserved for Internal Audit.</p>
  </div>

  <div class="toc">
${rows}
  </div>

  <h3><span class="n"></span>Who this manual is for</h3>
  <p class="p">You have an <b>Action Owner</b> account. Internal Audit raises observations against
  your department and names an action owner for each one; everyone in the department sees them, and
  any of you can respond here — describing what was done, attaching the evidence, and sending the
  item back for verification.</p>
  <p class="p">Internal Audit staff and the Head of Internal Audit use the full
  <b>AuditLens User Manual</b>, which also covers raising observations, the assessment modules and
  administration. Ask Internal Audit for it if you need it.</p>

  <div class="note">
    <b>If you get stuck.</b> Every observation names the auditor who raised it. Contact them, or the
    Head of Internal Audit, rather than working around the system — a note left on the observation
    itself is always visible to both of you.
  </div>
</section>`;
}

function ownerCover(): string {
  return `<section class="sheet cover" id="cover">
  <div class="cover-geo"><i class="g1"></i><i class="g3"></i><i class="g2"></i></div>
  <div class="cover-class">Document Classification – Internal</div>
  <div class="cover-top">
    <i class="mark" aria-hidden="true"></i>
    <div>Nigerian Consumer<br>Credit Corporation</div>
  </div>
  <div class="cover-body">
    <div class="cover-rule"></div>
    <h1>Audit<em>Lens</em></h1>
    <div class="cover-sub">Action Owner Guide — responding to and closing observations</div>
    <div class="cover-meta">
      <div>Version<b>1.0</b></div>
      <div>Date<b>${DOC_DATE}</b></div>
      <div>Owner<b>Internal Audit</b></div>
      <div>Audience<b>Action Owners</b></div>
    </div>
  </div>
</section>`;
}

/* ---------------------------------------------------------------- build */

function build(): void {
  const src = readFileSync(SRC, "utf8");
  mkdirSync(ASSET_DIR, { recursive: true });

  const rawCss = slice(src, "<style>", "</style>", "the stylesheet");
  const css = externaliseFont(rawCss);
  const figs = figures(src);
  console.log(`  source: ${figs.length} figures, ${Math.round(src.length / 1024)} kB`);

  /* ---- 1. the full manual ---- */
  const fullBody = deJavaScript(
    src.slice(src.indexOf('<div class="shell">'), src.lastIndexOf("</div>") + "</div>".length),
  );
  const full = page({
    title: "AuditLens — User Manual",
    css,
    body: fullBody,
    // The contents sheet is the second .sheet in the source and carries no id; give the cover one
    // so the mobile jump button has somewhere to land.
    jumpTo: "top",
  }).replace('<div class="shell">', '<div class="shell" id="top">');
  writeFileSync(join(OUT_DIR, "user-manual.html"), full);
  console.log(`  built:  public/docs/user-manual.html  ${Math.round(full.length / 1024)} kB`);

  /* ---- 2. the action owner manual ---- */
  if (!existsSync(OWNER_BODY)) {
    console.warn(`  SKIPPED action-owner-manual.html — ${OWNER_BODY} does not exist yet`);
    return;
  }
  let ownerBody = readFileSync(OWNER_BODY, "utf8");

  const used = new Map<string, number>();
  ownerBody = ownerBody.replace(/\{\{FIG:(\d+)\}\}/g, (_m, n: string) => {
    const i = Number(n);
    used.set(n, (used.get(n) || 0) + 1);
    const url = figs[i - 1];
    if (!url) throw new Error(`build-docs: the owner manual asks for {{FIG:${i}}}, but the source manual only has ${figs.length} figures`);
    return url;
  });
  const reused = [...used.entries()].filter(([, c]) => c > 1);
  if (reused.length) {
    throw new Error(
      `build-docs: figure token(s) used more than once: ${reused.map(([n, c]) => `{{FIG:${n}}}×${c}`).join(", ")}`,
    );
  }
  const leftover = ownerBody.match(/\{\{[^}]+\}\}/g);
  if (leftover) throw new Error(`build-docs: unsubstituted placeholders: ${[...new Set(leftover)].join(", ")}`);

  const secs = outlineOf(ownerBody);
  if (!secs.length) throw new Error("build-docs: no <section class=\"sheet\" id=\"sN\"> blocks in the owner body");

  const owner = page({
    title: "AuditLens — Action Owner Guide",
    css,
    body: `<div class="shell" id="top">

${ownerRail(secs)}

<main class="doc">

${ownerCover()}

${ownerFrontMatter(secs)}

${ownerBody.trim()}

</main>
</div>`,
    jumpTo: "toc",
  });
  writeFileSync(join(OUT_DIR, "action-owner-manual.html"), owner);
  console.log(
    `  built:  public/docs/action-owner-manual.html  ${Math.round(owner.length / 1024)} kB` +
      `  (${secs.length} sections, ${used.size} figures)`,
  );
  for (const s of secs) console.log(`            ${s.num}. ${s.title}  (${s.subs.length} subsections)`);
}

console.log(`build-docs — ${ORG}`);
build();
console.log("done.");
