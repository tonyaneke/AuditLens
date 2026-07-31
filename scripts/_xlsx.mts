// Minimal read-only .xlsx reader for the backlog migration.
//
// Deliberately dependency-free. Pulling a spreadsheet library into the app's dependency tree for
// one import script is a poor trade: xlsx parsers are large, historically CVE-prone, and this
// runs against production data. What we need is small — a zip container and two XML shapes — so
// it is written out here where it can be read and reviewed in full.
//
// Scope limits (all satisfied by the migration workbook, all fail loudly rather than silently):
//   · store (0) and deflate (8) entries only — no zip64, no encryption, no data descriptors.
//   · cell values only. Formulas are not evaluated; a formula cell yields its cached <v>.
//   · dates come back as the raw Excel serial number. Number formats are not read — the caller
//     knows which columns are dates and converts explicitly (see excelSerialToIso).

import { inflateRawSync } from "node:zlib";
import fs from "node:fs";

/* ------------------------------------------------------------------------------------- zip */

type ZipEntry = { name: string; data: Buffer };

/** Read the central directory and inflate every entry. */
function unzip(buf: Buffer): Map<string, Buffer> {
  // End of Central Directory: scan back from the tail for the signature. The trailing comment
  // is at most 64 KB, so that bounds the search.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file: no end-of-central-directory record found.");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  if (ptr === 0xffffffff) throw new Error("Zip64 archives are not supported by this reader.");

  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error(`Corrupt central directory at entry ${n}.`);
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Corrupt local header for "${name}".`);
    }
    // The local header repeats the name/extra lengths, and its extra field can differ in
    // length from the central directory's — always read the local one.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`"${name}" uses unsupported compression method ${method}.`);
  }
  return out;
}

/* ------------------------------------------------------------------------------------- xml */

/** Resolve XML entities, numeric character references included. `&amp;` is expanded last so a
 *  literal "&amp;lt;" in the source survives as the text "&lt;" rather than becoming "<". */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** All <t> text inside a fragment, concatenated — a shared string split across rich-text runs
 *  is one value, not several. */
function textOf(fragment: string): string {
  let out = "";
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1]);
  return out;
}

/** "BC12" → 54 (zero-based column index). */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---------------------------------------------------------------------------------- public */

export type Sheet = {
  name: string;
  /** Row-major grid. Every row is padded to the widest row so `row[i]` is always defined. */
  rows: string[][];
};

/**
 * Read every worksheet in a workbook, in the tab order the workbook declares.
 *
 * Values are returned as trimmed strings, with CRLF normalised to LF — Excel stores hard line
 * breaks inside a cell as \r\n and the app's stored text uses \n throughout.
 */
export function readWorkbook(file: string): Sheet[] {
  const zip: Map<string, Buffer> = unzip(fs.readFileSync(file));

  const get = (name: string): string => {
    const b = zip.get(name);
    if (!b) throw new Error(`"${name}" is missing — is this really an .xlsx workbook?`);
    return b.toString("utf8");
  };

  // Shared strings: every non-inline cell string is an index into this table.
  const shared: string[] = [];
  const ssRaw = zip.get("xl/sharedStrings.xml");
  if (ssRaw) {
    for (const m of ssRaw.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(textOf(m[1]));
    }
  }

  // rId → worksheet part, so sheets are read in tab order rather than file order.
  const rels = new Map<string, string>();
  for (const m of get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, ""));
  }

  const sheets: Sheet[] = [];
  for (const m of get("xl/workbook.xml").matchAll(/<sheet\s([^>]*)\/>/g)) {
    const name = unescapeXml(/name="([^"]*)"/.exec(m[1])?.[1] || "");
    const rid = /r:id="([^"]+)"/.exec(m[1])?.[1] || "";
    const part = rels.get(rid);
    if (!part) throw new Error(`Sheet "${name}" has no worksheet part (${rid}).`);
    sheets.push({ name, rows: parseSheet(get("xl/" + part), shared) });
  }
  return sheets;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const sparse: string[][] = [];
  let width = 0;

  for (const rm of xml.matchAll(/<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIndex = parseInt(rm[1], 10) - 1;
    const cells: string[] = [];

    // Self-closing <c .../> (an empty but styled cell) and <c ...>…</c> in one pass.
    for (const cm of rm[2].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] || "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];

      let value = "";
      if (type === "inlineStr") {
        value = textOf(body);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (v) value = type === "s" ? (shared[parseInt(v[1], 10)] ?? "") : unescapeXml(v[1]);
      }
      cells[colIndex(ref)] = value.replace(/\r\n/g, "\n").trim();
    }
    sparse[rowIndex] = cells;
    width = Math.max(width, cells.length);
  }

  // Densify: a sparse row is a hole in the grid, and every caller indexes by column number.
  const rows: string[][] = [];
  for (let r = 0; r < sparse.length; r++) {
    const src = sparse[r] || [];
    const row: string[] = [];
    for (let c = 0; c < width; c++) row.push(src[c] ?? "");
    rows.push(row);
  }
  return rows;
}

/**
 * Excel serial date → ISO `YYYY-MM-DD`, or "" if the value is not a plausible date.
 *
 * The epoch is 1899-12-30, not 1900-01-01: Excel treats 1900 as a leap year (it was not) for
 * Lotus compatibility, and shifting the epoch back two days is the standard way to absorb that
 * for any date after 1900-03-01 — which is every date in this workbook.
 *
 * The lower bound rejects values that are day-counts rather than dates. The workbook has one:
 * a target date recorded as "30" (meaning 30 days), which as a serial would be January 1900.
 */
export function excelSerialToIso(raw: string): string {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return "";
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO `YYYY-MM-DD` → Excel serial, so derived dates round-trip against the workbook. */
export function isoToExcelSerial(iso: string): number {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Shift an ISO date by whole days. */
export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

export type { ZipEntry };
