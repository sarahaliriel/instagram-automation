import { describe, expect, it } from "vitest";
import { encryptCommentText, decryptCommentText } from "./encryption";
const key = "a".repeat(64);
describe("minimal comment storage encryption", () => {
  it("encrypts text with authenticated context and a new nonce", () => {
    const text = "synthetic private text";
    const encrypted = encryptCommentText(text, key, "account:comment");
    expect(encrypted).not.toContain(text);
    expect(decryptCommentText(encrypted, key, "account:comment")).toBe(text);
    expect(encryptCommentText(text, key, "account:comment")).not.toBe(
      encrypted,
    );
    expect(() => decryptCommentText(encrypted, key, "other-comment")).toThrow(
      "decryption failed",
    );
    expect(() =>
      decryptCommentText(encrypted, "b".repeat(64), "account:comment"),
    ).toThrow("decryption failed");
  });
  it("supports empty text but rejects malformed keys/envelopes without including input", () => {
    expect(
      decryptCommentText(
        encryptCommentText("", key, "context"),
        key,
        "context",
      ),
    ).toBe("");
    expect(() => encryptCommentText("secret", "bad", "context")).toThrow(
      "configuration",
    );
    expect(() => decryptCommentText("secret", key, "context")).toThrow(
      "Comment decryption failed",
    );
  });
});
