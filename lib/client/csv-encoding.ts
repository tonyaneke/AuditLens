"use client";

// QA defect #2 — the live re-infection vector for corrupted characters.
//
// Both CSV importers used `FileReader.readAsText(file)` with no encoding argument. That
// defaults to UTF-8, and — critically — UTF-8 decoding is LENIENT by default: a byte sequence
// that isn't valid UTF-8 is not an error, it is silently replaced with U+FFFD. Excel on Windows
// writes CSV as Windows-1252 unless you explicitly choose otherwise, so every ’ — – £ € in a
// spreadsheet-authored file became a replacement character the moment it was imported, and the
// original byte was gone. That is how 137 corrupted characters got into the audit records.
//
// readTextFile() decodes deliberately instead:
//   1. Honour a byte-order mark if one is present.
//   2. Otherwise try UTF-8 in STRICT mode, so invalid input throws instead of being mangled.
//   3. Only on failure fall back to Windows-1252, which is what the file almost certainly is.
//
// AuditLens's own exporters write a UTF-8 BOM (see components/external/exports.ts), so a
// round-trip through this app takes path 1 and is exact.

export type DecodedText = { text: string; encoding: string };

export async function readTextFile(file: Blob): Promise<DecodedText> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16LE" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16BE" };
  }

  try {
    // fatal: true is the whole point — it turns silent corruption into a caught exception.
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}

/** Any replacement character that survives decoding came from the source file itself, not from
 * our decoding. Worth telling the user rather than writing it into an audit record. */
export function countReplacementChars(text: string): number {
  return (text.match(/�/g) || []).length;
}
