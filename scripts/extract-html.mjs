import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "..", "Audit-Reporting-Bot (1).html");
const html = fs.readFileSync(htmlPath, "utf8");

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);

if (!styleMatch || !scriptMatch) {
  console.error("Could not extract style or script from HTML");
  process.exit(1);
}

let script = scriptMatch[1];

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

fs.mkdirSync(path.join(root, "public"), { recursive: true });
fs.writeFileSync(path.join(root, "app", "globals.css"), styleMatch[1].trim() + "\n");
fs.writeFileSync(path.join(root, "public", "audit-bot.js"), script.trim() + "\n");

console.log("Extracted CSS -> app/globals.css");
console.log("Extracted JS  -> public/audit-bot.js");
