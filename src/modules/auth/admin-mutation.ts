import { isAuthorizedAdmin, type AdminCredentials } from "./admin-auth";

export type AdminMutationRequest = Readonly<{
  authorization: string | null;
  origin: string | null;
  host: string | null;
}>;

export async function isAuthorizedAdminMutation(
  request: AdminMutationRequest,
  credentials: AdminCredentials | null,
  applicationUrl: string | undefined,
) {
  if (!(await isAuthorizedAdmin(request.authorization, credentials)))
    return false;
  if (!request.origin || !request.host || !applicationUrl) return false;
  try {
    const expected = new URL(applicationUrl);
    const actual = new URL(request.origin);
    return actual.origin === expected.origin && request.host === expected.host;
  } catch {
    return false;
  }
}
