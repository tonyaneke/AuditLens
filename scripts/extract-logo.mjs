import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const js = fs.readFileSync(path.join(__dirname, "../public/audit-bot.js"), "utf8");
const marker = 'const LOGO = "';
const start = js.indexOf(marker);
if (start === -1) {
  console.error("LOGO not found");
  process.exit(1);
}
const from = start + marker.length;
const end = js.indexOf('"', from);
const dataUrl = js.slice(from, end);
const b64 = dataUrl.split(",")[1];
fs.writeFileSync(path.join(__dirname, "../public/org-logo.png"), Buffer.from(b64, "base64"));
console.log("Extracted org-logo.png");
