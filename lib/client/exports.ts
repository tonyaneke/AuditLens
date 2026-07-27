"use client";

// Download / Office-export cores (ports of legacy dl(), wordDoc(), csv helpers). Per-feature
// export builders live with their feature components and call these.

export function dl(content: string, name: string, type: string): void {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function stamp(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    ("0" + (d.getMonth() + 1)).slice(-2) +
    ("0" + d.getDate()).slice(-2)
  );
}

export function esc(s: unknown): string {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

const WORD_CSS = `body{font-family:'Calibri',sans-serif;font-size:11pt;color:#1c2733}
    h1{color:#0d5a47;font-size:20pt;margin:0 0 4pt} h2{color:#0d5a47;font-size:14pt;border-bottom:1.5pt solid #0d5a47;padding-bottom:3pt;margin-top:18pt}
    h3{color:#10745a;font-size:12pt;margin:12pt 0 2pt} .meta{color:#64748b;font-size:9.5pt}
    table{border-collapse:collapse;width:100%;margin:6pt 0} td,th{border:0.75pt solid #cbd5e1;padding:5pt 7pt;font-size:10pt;vertical-align:top} th{background:#0d5a47;color:#fff;text-align:left}
    .pill{padding:1pt 7pt;border-radius:8pt;font-size:9pt;font-weight:bold}
    .Critical{background:#f6dde0;color:#7a0012} .High{background:#fdecef;color:#b00020} .Moderate{background:#fdefe6;color:#e8590c} .Low{background:#eaf5eb;color:#2e7d32} .Improve{background:#e7eef5;color:#2c5f8a}
    .obs{border:0.75pt solid #cbd5e1;border-left:4pt solid #999;padding:8pt 11pt;margin:8pt 0}
    .ttl{font-size:8.5pt;color:#64748b;text-transform:uppercase;font-weight:bold;margin-top:6pt} .note{background:#e9f8f2;border:0.75pt solid #c6e9df;border-left:3pt solid #0d5a47;padding:7pt 9pt;margin:6pt 0}
    .hint{color:#64748b;font-size:9.5pt} ul{margin:4pt 0;padding-left:16pt}`;

/** MS-Word-flavoured HTML document, downloaded as .doc (same technique as legacy wordDoc). */
export function wordDoc(title: string, inner: string, logoDataUrl?: string): void {
  const header = logoDataUrl
    ? `<div style="text-align:center;margin-bottom:8pt"><img src="${logoDataUrl}" style="max-height:64pt"></div>`
    : "";
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
    <head><meta charset="utf-8"><style>${WORD_CSS}</style></head><body>${header}${inner}</body></html>`;
  dl(html, title + ".doc", "application/msword");
}

/** Excel-flavoured HTML table document, downloaded as .xls. */
export function excelDoc(title: string, tableHtml: string): void {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="utf-8"><style>td,th{border:0.5pt solid #cbd5e1;padding:4pt 6pt;font-family:Calibri,sans-serif;font-size:10pt;vertical-align:top}th{background:#0d5a47;color:#fff;text-align:left}</style></head>
    <body>${tableHtml}</body></html>`;
  dl(html, title + ".xls", "application/vnd.ms-excel");
}

export function csvEsc(v: unknown): string {
  return `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
}

export function csvString(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
}
