// Synthetic identifiers and text only. Never replace with production webhook captures.
export const webhookConfig = {
  appSecret: "test-only-app-secret-00000000000000",
  verifyToken: "test-only-verify-token-000000000000",
  accountId: "100000000000001",
};
export function commentFixture() {
  return {
    object: "instagram",
    entry: [
      {
        id: webhookConfig.accountId,
        time: 1794873600,
        changes: [
          {
            field: "comments",
            value: {
              comment_id: "200000000000001",
              text: "FORMULÁRIO — synthetic fixture",
              from: { id: "300000000000001", username: "synthetic_test_user" },
              media: { id: "400000000000001", media_product_type: "FEED" },
            },
          },
        ],
      },
    ],
  };
}
