import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const routes = new Set([
  "index.html",
  "privacy/index.html",
  "terms/index.html",
  "data-deletion/index.html",
]);
const forbidden = [
  /DATABASE_URL/i,
  /META_SYSTEM_USER_ACCESS_TOKEN/i,
  /META_WEBHOOK_APP_SECRET/i,
  /INSTAGRAM_WEBHOOK_VERIFY_TOKEN/i,
  /EVENT_ENCRYPTION_KEY/i,
  /\/api\/(?:webhooks|inngest|health|admin)/i,
  /subscribed_apps/i,
  /prisma\/schema\.prisma/i,
  /\.env\.local/i,
];

export async function auditArtifact(root) {
  const files = [];
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const absolute = join(directory, name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error("Symlink in artifact");
      if (stat.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!stat.isFile()) throw new Error("Non-file in artifact");
      const rel = relative(root, absolute).split(sep).join("/");
      const isAsset = /^_next\/static\/css\/[a-zA-Z0-9_-]+\.css$/.test(rel);
      if (!routes.has(rel) && !isAsset)
        throw new Error(`Unexpected artifact file: ${rel}`);
      if (rel.endsWith(".map")) throw new Error("Source map in artifact");
      const bytes = await readFile(absolute);
      const text = bytes.toString("utf8");
      if (
        rel.endsWith(".html") &&
        (/<script\b/i.test(text) || /<form\b/i.test(text))
      )
        throw new Error(`Executable script or form in artifact: ${rel}`);
      if (forbidden.some((pattern) => pattern.test(text)))
        throw new Error(`Forbidden content in artifact: ${rel}`);
      files.push({ path: rel, bytes: stat.size });
    }
  }
  await visit(root);
  for (const route of routes)
    if (!files.some((file) => file.path === route))
      throw new Error(`Missing route: ${route}`);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
