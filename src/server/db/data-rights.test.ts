import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  executeDataRightsErasure,
  prepareDataRightsErasure,
} from "./data-rights";

const neverDatabase = {
  $transaction: () => {
    throw new Error("database was reached");
  },
} as unknown as PrismaClient;

describe("data rights fail-closed inputs", () => {
  it("rejects insufficient or ambiguous scope before database access", async () => {
    for (const commentProviderId of ["", "abc", "1/2", "1%32", "1 "]) {
      await expect(
        prepareDataRightsErasure(neverDatabase, {
          accountProviderId: "123",
          commentProviderId,
        }),
      ).rejects.toThrow("denied");
    }
  });

  it("rejects execution without a pinned reviewer key before database access", async () => {
    const prior = process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
    delete process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
    try {
      await expect(
        executeDataRightsErasure(
          neverDatabase,
          { accountProviderId: "123", commentProviderId: "456" },
          {
            caseId: "00000000-0000-4000-8000-000000000001",
            digest: "a".repeat(64),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            signature: "invalid",
          },
          "invalid",
        ),
      ).rejects.toThrow("denied");
    } finally {
      if (prior === undefined)
        delete process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
      else process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256 = prior;
    }
  });

  it("rejects an expired approval before database access", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicPem = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const prior = process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
    process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256 = createHash("sha256")
      .update(publicPem)
      .digest("hex");
    try {
      const caseId = randomUUID();
      const digest = "a".repeat(64);
      const expiresAt = new Date(Date.now() - 1000).toISOString();
      const signature = sign(
        null,
        Buffer.from(
          `data-rights-erasure:v1\n${caseId}\n${digest}\n${expiresAt}`,
        ),
        privateKey,
      ).toString("base64");
      await expect(
        executeDataRightsErasure(
          neverDatabase,
          { accountProviderId: "123", commentProviderId: "456" },
          { caseId, digest, expiresAt, signature },
          publicPem,
        ),
      ).rejects.toThrow("denied");
    } finally {
      if (prior === undefined)
        delete process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
      else process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256 = prior;
    }
  });
});
