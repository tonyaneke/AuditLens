// Sealed hand-off between the two halves of a chunked upload.
//
// A large file cannot be POSTed to /api/files in one request: the host in front of this app caps
// a serverless request body at ~4.5 MB, and refuses anything bigger before the route runs (that
// is the bare "413" with no JSON body). So the browser slices the file and sends the pieces, and
// the server relays each piece into a Microsoft Graph upload session.
//
// That session has to survive between chunk requests, and on serverless there is no process to
// keep it in — every chunk may land on a different instance. Rather than add a table and a
// migration for state that lives for minutes, the session is ENCRYPTED into a token the client
// carries back with each chunk.
//
// Encrypted, not merely signed: a signed JWT's payload is readable, and the payload here is a
// pre-authorised Graph upload URL. Anyone who could read it could write bytes into our SharePoint
// drive without a session. A256GCM keeps it opaque, and the token is bound to the user who
// created it and expires with the upload.

import { EncryptJWT, jwtDecrypt } from "jose";

const ALG = "dir";
const ENC = "A256GCM";

/** A256GCM needs exactly 32 bytes. AUTH_SECRET is an arbitrary-length string, so derive rather
 *  than truncate — a short secret would otherwise throw at runtime instead of at boot. */
async function uploadKey(): Promise<Uint8Array> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured.");
  // Domain-separated from the session cookie: the same secret must not produce the same key for
  // two different purposes.
  const material = new TextEncoder().encode(`auditlens:upload:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return new Uint8Array(digest);
}

export type UploadTicket = {
  /** Graph upload session URL — pre-authorised, never exposed to the browser. */
  uploadUrl: string;
  /** Session user who opened the upload; every chunk is checked against this. */
  userId: string;
  /** Total bytes promised at session creation — the server holds the client to it. */
  size: number;
  fileName: string;
};

/** Graph upload sessions live ~15 minutes from last activity; the ticket matches. */
const TICKET_TTL = "20m";

export async function sealUploadTicket(t: UploadTicket): Promise<string> {
  return new EncryptJWT({ ...t })
    .setProtectedHeader({ alg: ALG, enc: ENC })
    .setIssuedAt()
    .setExpirationTime(TICKET_TTL)
    .encrypt(await uploadKey());
}

export async function openUploadTicket(token: string): Promise<UploadTicket | null> {
  try {
    const { payload } = await jwtDecrypt(token, await uploadKey());
    const t = payload as unknown as UploadTicket;
    if (!t.uploadUrl || !t.userId) return null;
    return t;
  } catch {
    return null; // tampered, expired, or signed with a different secret
  }
}
