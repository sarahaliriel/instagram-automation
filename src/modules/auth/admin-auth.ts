export type AdminCredentials = Readonly<{
  username: string;
  password: string;
}>;

export function parseAdminCredentials(
  environment: Record<string, string | undefined>,
): AdminCredentials | null {
  const username = environment.ADMIN_USERNAME;
  const password = environment.ADMIN_PASSWORD;
  if (!username || !password || username.length > 128 || password.length < 16)
    return null;
  return { username, password };
}

function decodeBasic(value: string): AdminCredentials | null {
  if (!value.startsWith("Basic ")) return null;
  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function equal(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    digest(left),
    digest(right),
  ]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1)
    difference |= leftHash[index]! ^ rightHash[index]!;
  return difference === 0;
}

export async function isAuthorizedAdmin(
  authorization: string | null,
  expected: AdminCredentials | null,
) {
  const actual = authorization ? decodeBasic(authorization) : null;
  if (!expected || !actual) return false;
  const [usernameMatches, passwordMatches] = await Promise.all([
    equal(actual.username, expected.username),
    equal(actual.password, expected.password),
  ]);
  return usernameMatches && passwordMatches;
}
