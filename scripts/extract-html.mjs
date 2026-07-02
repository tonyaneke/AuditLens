import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "..", "Audit-Reporting-Bot (1).html");
const html = fs.readFileSync(htmlPath, "utf8");

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);

if (!scriptMatch) {
  console.error("Could not extract script from HTML");
  process.exit(1);
}

let script = scriptMatch[1];

// Next.js init: defer DOM access until mount
script = script.replace(
  "/* ============================ ROUTER ============================ */\ndocument.getElementById(\"nav\").addEventListener(\"click\",e=>{\n  const b=e.target.closest(\"button\"); if(!b)return;\n  go(b.dataset.view);\n});",
  "/* ============================ ROUTER ============================ */"
);

script = script.replace(
  "const ov=document.getElementById(\"overlay\");",
  "let ov;"
);

script = script.replace(
  "ov.addEventListener(\"click\",e=>{ if(e.target===ov) closeModal(); });",
  ""
);

script = script.replace(
  "/* ============================ INIT ============================ */\n(function(){ const s=logoSrc(); if(s){ const f=document.getElementById(\"favicon\"), t=document.getElementById(\"touchicon\"); if(f)f.href=s; if(t)t.href=s; } })();\nrender();",
  `/* ============================ INIT ============================ */
function initAuditBot(){
  ov = document.getElementById("overlay");
  if (ov) ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(); });
  document.getElementById("nav").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    go(b.dataset.view);
  });
  (function(){ const s=logoSrc(); if(s){ const f=document.getElementById("favicon"), t=document.getElementById("touchicon"); if(f)f.href=s; if(t)t.href=s; } })();
  render();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAuditBot);
else initAuditBot();`
);

// AMS patches (applied after base extraction)
function applyAmsPatches(src) {
  let s = src;

  if (!s.includes('if(v==="newobs"){ modalNewObs(); return; }')) {
    s = s.replace(
      "function go(v,opts={}){\n  if(v===\"insights\")",
      "function go(v,opts={}){\n  if(v===\"newobs\"){ modalNewObs(); return; }\n  if(v===\"insights\")"
    );
  }

  if (!s.includes("orgChip")) {
    s = s.replace(
      "function render(){\n  document.getElementById(\"orgName\").textContent = (DB.org||\"Internal Audit\");",
      "function render(){\n  const org=DB.org||\"Internal Audit\";\n  const _on=document.getElementById(\"orgName\"); if(_on) _on.textContent=org;\n  const _oc=document.getElementById(\"orgChip\"); if(_oc) _oc.textContent=org;"
    );
  }

  s = s.replace(
    /if\(view==="dashboard"\)\{ T\.textContent="CAE \/ MD Dashboard"; C\.innerHTML=viewDashboard\(\); \}/,
    'if(view==="dashboard"){ T.textContent="CAE / MD Dashboard"; A.innerHTML=`<button class="btn" onclick="modalNewObs()">+ New Observation</button>`; C.innerHTML=viewDashboard(); }'
  );

  s = s.replace(
    /\n  else if\(view==="newobs"\)\{ T\.textContent="New Observation"; C\.innerHTML=viewNewObs\(\); \}/,
    ""
  );

  if (!s.includes("function modalNewObs()")) {
    s = s.replace(
      "function closeModal(){ ov.classList.remove(\"show\"); }",
      `function openModal(title,body,foot){
  const m=document.getElementById("modal");
  if(m) m.classList.remove("wide");
  document.getElementById("modalTitle").textContent=title;
  document.getElementById("modalBody").innerHTML=body;
  document.getElementById("modalFoot").innerHTML=foot;
  ov.classList.add("show");
}
function closeModal(){
  ov.classList.remove("show");
  const m=document.getElementById("modal");
  if(m) m.classList.remove("wide");
}
function modalNewObs(){
  openModal("New Observation", viewNewObs(), \`<button class="btn sec" onclick="closeModal()">Close</button>\`);
  const m=document.getElementById("modal");
  if(m) m.classList.add("wide");
}`
    );
    // If openModal already exists, only add modalNewObs
    if (s.includes("function modalNewObs()") === false && s.includes("function openModal(title,body,foot){")) {
      // already patched above via closeModal replace - skip duplicate
    }
  }

  s = s.replace(
    "Go to <b>New Observation</b>, enter your one-liner",
    "On the <b>Dashboard</b>, click <b>+ New Observation</b>, enter your one-liner"
  );
  s = s.replace(
    "from the New Observation page",
    "from the New Observation modal"
  );

  // Remove side-stripe inline styles in UI (keep Word export CSS)
  s = s.replace(
    'border-left:4px solid var(--accent)',
    'background:#e9f8f2;border-color:#c6e9df'
  );
  s = s.replace(
    /border-left:4px solid \$\{BAND_HEX\[f\.res\]\}/g,
    "background:${hx2rgba(BAND_HEX[f.res],.1)};border-color:${hx2rgba(BAND_HEX[f.res],.35)}"
  );
  s = s.replace(
    /border-left:4px solid \$\{hex\}/g,
    "background:${hx2rgba(hex,.1)};border-color:${hx2rgba(hex,.35)}"
  );
  s = s.replace(
    /border-left:4px solid \$\{CONF_HEX\[x\.c\]\}/g,
    "background:${hx2rgba(CONF_HEX[x.c],.1)};border-color:${hx2rgba(CONF_HEX[x.c],.35)}"
  );
  s = s.replace(
    'border-left:4px solid #6b3fa0',
    'background:#f3eef8;border-color:#d4c4e8'
  );

  return s;
}

script = applyAmsPatches(script);

fs.mkdirSync(path.join(root, "public"), { recursive: true });
fs.writeFileSync(path.join(root, "public", "audit-bot.js"), script.trim() + "\n");

console.log("Extracted JS -> public/audit-bot.js (AMS patches applied)");
console.log("CSS unchanged — maintained in app/globals.css");
