import assert from "node:assert/strict";
import test from "node:test";

// Synthetic rehearsal of record scoping only. It never connects to a database
// and is not an implementation of access, rectification or erasure.
test("a rights request selects only the authorised account and exact comment", () => {
  const comments = [
    { id: "comment-a", account: "account-a", providerId: "synthetic-1" },
    { id: "comment-b", account: "account-a", providerId: "synthetic-2" },
    { id: "comment-c", account: "other", providerId: "synthetic-1" },
  ];
  const events = [
    { id: "event-a", commentId: "comment-a" },
    { id: "event-b", commentId: "comment-b" },
    { id: "event-c", commentId: "comment-c" },
  ];
  const selected = comments.filter(
    (row) => row.account === "account-a" && row.providerId === "synthetic-1",
  );
  assert.deepEqual(
    selected.map((row) => row.id),
    ["comment-a"],
  );
  assert.deepEqual(
    events.filter((row) =>
      selected.some((comment) => comment.id === row.commentId),
    ),
    [{ id: "event-a", commentId: "comment-a" }],
  );
  assert.equal(comments.length, 3);
  assert.equal(events.length, 3);
});
