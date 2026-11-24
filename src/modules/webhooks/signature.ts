import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function equalSecret(actual: string, expected: string): boolean {
  // Fixed-length digests keep timingSafeEqual safe for differing input lengths.
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function verifyInstagramSignature(
  rawBody: Uint8Array,
  signature: string | null,
  appSecret: string,
): boolean {
  if (!appSecret || !signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature))
    return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
