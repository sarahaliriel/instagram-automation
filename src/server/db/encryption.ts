import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(key: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(key))
    throw new Error("Invalid event encryption configuration");
  return Buffer.from(key, "hex");
}
export function encryptCommentText(
  text: string,
  key: string,
  context: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}
export function decryptCommentText(
  value: string,
  key: string,
  context: string,
): string {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (
      version !== "v1" ||
      !iv ||
      !tag ||
      ciphertext === undefined ||
      extra !== undefined
    )
      throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyBytes(key),
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Comment decryption failed");
  }
}
export function commentEncryptionContext(accountId: string, commentId: string) {
  return JSON.stringify(["instagram.comment.v1", accountId, commentId]);
}
