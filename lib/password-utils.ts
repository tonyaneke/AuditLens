import { randomBytes } from "crypto";

/** Random temporary password for new accounts (min 12 chars). */
export function generateTempPassword() {
  return randomBytes(12).toString("base64url");
}
