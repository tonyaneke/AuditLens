// A minimal ZIP writer and reader — just what the database backup needs (lib/backup.ts writes one,
// scripts/restore-workspace.mts reads it back). Deflate comes from node:zlib, so there is no
// dependency to add: jszip is in node_modules only as a transitive dependency of mammoth, and
// importing it directly would break the day mammoth stops needing it.
//
// Deliberately small: a handful of UTF-8 named files, each well under 4 GB. No ZIP64, encryption
// or streaming. The files it writes open in Windows Explorer, macOS Archive Utility and `tar -xf`.

import { deflateRawSync, inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer | string };

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const UTF8_NAMES = 0x0800;
const STORED = 0;
const DEFLATED = 8;
const MAX_32 = 0xffffffff;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 as ZIP uses it. zlib.crc32 would do, but only exists from Node 20.15 / 22.2. */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, the only timestamp a basic ZIP entry carries. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function createZip(entries: ZipEntry[], when = new Date()): Buffer {
  if (entries.length > 0xffff) throw new Error("Too many files for a ZIP without ZIP64.");
  const { time, date } = dosDateTime(when);
  const body: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : e.data;
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);
    if (raw.length >= MAX_32 || offset + packed.length >= MAX_32) {
      throw new Error(`"${e.name}" is too large for a ZIP without ZIP64.`);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATED, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    // 28: extra field length — none

    const head = Buffer.alloc(46);
    head.writeUInt32LE(CENTRAL_SIG, 0);
    head.writeUInt16LE(20, 4); // version made by
    head.writeUInt16LE(20, 6); // version needed
    head.writeUInt16LE(UTF8_NAMES, 8);
    head.writeUInt16LE(DEFLATED, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(name.length, 28);
    // 30–41: extra/comment lengths, disk number, attributes — all zero
    head.writeUInt32LE(offset, 42);

    body.push(local, name, packed);
    central.push(head, name);
    offset += local.length + name.length + packed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, directory, end]);
}

/** Every file in a ZIP, by name. Verifies each checksum, so a damaged backup fails loudly here
 *  rather than half-restoring. Reads what createZip writes, and ordinary deflate/stored ZIPs. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  let end = -1;
  // The end record is the last 22 bytes unless the archive has a comment (up to 64 KB) after it.
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === END_SIG) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP file.");

  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== CENTRAL_SIG) throw new Error("The ZIP file's directory is damaged.");
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const packedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localAt = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);

    // Sizes come from the central directory: a local header may leave them zero (data descriptor).
    const start = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const packed = zip.subarray(start, start + packedSize);
    let data: Buffer;
    if (method === STORED) data = Buffer.from(packed);
    else if (method === DEFLATED) data = inflateRawSync(packed);
    else throw new Error(`"${name}" uses a compression method this reader does not support.`);
    if (crc32(data) !== crc) throw new Error(`"${name}" failed its checksum — the file is damaged.`);

    if (!name.endsWith("/")) out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
