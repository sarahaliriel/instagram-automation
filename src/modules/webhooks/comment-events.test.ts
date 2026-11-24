import { describe, expect, it } from "vitest";
import {
  commentFixture,
  webhookConfig,
} from "../../../tests/fixtures/instagram";
import { commentEventId, parseInstagramEvents } from "./comment-events";

const parse = (payload: unknown) =>
  parseInstagramEvents(
    payload,
    webhookConfig.accountId,
    webhookConfig.appSecret,
  );
describe("Unified Login comment parsing", () => {
  it("normalizes the changes envelope and omits unneeded personal fields", () => {
    const result = parse(commentFixture());
    expect(result.comments[0]).toMatchObject({
      accountId: webhookConfig.accountId,
      commentId: "200000000000001",
      mediaId: "400000000000001",
      text: "FORMULÁRIO — synthetic fixture",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic_test_user");
    expect(result.comments[0]!.eventId).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects the previous Instagram Login direct-entry container", () => {
    const fixture = commentFixture();
    const entry = fixture.entry[0]!;
    const change = entry.changes[0]!;
    expect(() =>
      parse([
        {
          object: "instagram",
          entry: [{ id: entry.id, time: entry.time, ...change }],
        },
      ]),
    ).toThrow();
  });
  it("supports batched envelopes and comments without optional text/from", () => {
    const entry = commentFixture().entry[0]!;
    expect(
      parse([
        {
          object: "instagram",
          entry: [
            {
              ...entry,
              changes: [
                {
                  field: "comments",
                  value: { comment_id: "2", media: { id: "4" } },
                },
              ],
            },
          ],
        },
      ]).comments[0],
    ).not.toHaveProperty("text");
    expect(parse([commentFixture(), commentFixture()]).comments).toHaveLength(
      2,
    );
  });
  it("does not coerce numeric IDs or accept the previous id as comment_id", () => {
    const fixture = commentFixture();
    const entry = fixture.entry[0]!;
    expect(() =>
      parse({ ...fixture, entry: [{ ...entry, id: Number(entry.id) }] }),
    ).toThrow();
    expect(() =>
      parse({
        ...fixture,
        entry: [
          {
            ...entry,
            changes: [
              {
                field: "comments",
                value: { id: "2", media: { id: "4" } },
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it("rejects ambiguous event containers and unauthorized accounts", () => {
    const fixture = commentFixture();
    const entry = fixture.entry[0]!;
    expect(() =>
      parse({
        ...fixture,
        entry: [
          { ...entry, field: "comments", value: entry.changes[0]!.value },
        ],
      }),
    ).toThrow();
    expect(() =>
      parse({ ...fixture, entry: [{ ...entry, id: "999" }] }),
    ).toThrow();
  });
  it("tolerates additive metadata while rejecting malformed required fields", () => {
    const fixture = commentFixture();
    expect(
      parse({ ...fixture, future_metadata: "ignored" }).comments,
    ).toHaveLength(1);
    expect(() =>
      parse({ object: "instagram", entry: [{ id: "1" }] }),
    ).toThrow();
    expect(() => parse({ object: "instagram" })).toThrow();
    expect(() => parse({})).toThrow();
  });
  it("classifies messaging and foreign objects as unsupported", () => {
    expect(
      parse({
        object: "instagram",
        entry: [{ id: webhookConfig.accountId, time: 1, messaging: [{}] }],
      }).ignoredCount,
    ).toBe(1);
    expect(parse({ object: "page", entry: [] }).comments).toEqual([]);
  });
  it("derives stable keyed IDs independent of text and notification time", () => {
    const first = parse(commentFixture()).comments[0]!.eventId;
    const fixture = commentFixture();
    fixture.entry[0]!.time++;
    fixture.entry[0]!.changes[0]!.value.text = "other synthetic content";
    expect(parse(fixture).comments[0]!.eventId).toBe(first);
    expect(
      commentEventId(
        "other-account",
        "200000000000001",
        webhookConfig.appSecret,
      ),
    ).not.toBe(first);
    expect(
      commentEventId(webhookConfig.accountId, "200000000000001", "other-key"),
    ).not.toBe(first);
  });
  it("rejects mixed-model comment identifiers even if they agree", () => {
    const fixture = commentFixture();
    const value = fixture.entry[0]!.changes[0]!.value;
    Object.assign(value, { id: value.comment_id });
    expect(() => parse(fixture)).toThrow();
  });
  it("keeps canonical identifiers and HMAC context stable after the model change", () => {
    const event = parse(commentFixture()).comments[0]!;
    expect(event.eventId).toBe(
      commentEventId(
        event.accountId,
        "200000000000001",
        webhookConfig.appSecret,
      ),
    );
    expect(event.commentId).toBe("200000000000001");
    expect(event).not.toHaveProperty("comment_id");
  });
});
