import crypto from "crypto";

/**
 * Hash de fingerprint de dispositivo a partir del User-Agent. Nunca se
 * persiste PII cruda (design.md), solo este hash.
 */
export function computeDeviceHash(userAgent: string): string {
  return crypto.createHash("sha256").update(userAgent).digest("hex");
}
