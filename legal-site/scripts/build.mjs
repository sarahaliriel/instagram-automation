import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditArtifact } from "./audit.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(site, "..");
const app = join(site, "src/app");
const allowedSources = [
  "src/app/layout.tsx",
  "src/app/globals.css",
  "src/app/(legal)/layout.tsx",
  "src/app/(legal)/legal-page.tsx",
  "src/app/(legal)/legal.module.css",
  "src/app/(legal)/privacy/page.tsx",
  "src/app/(legal)/terms/page.tsx",
  "src/app/(legal)/data-deletion/page.tsx",
];

const secretName =
  /(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE|POSTGRES|INSTAGRAM|META_|INNGEST|EVENT_ENCRYPTION|CREDENTIAL|PRIVATE_KEY)/i;

export function hasSensitiveEnvironment(env) {
  return Object.keys(env).some(
    (name) => name !== "VERCEL_OIDC_TOKEN" && secretName.test(name),
  );
}

async function main() {
  if (hasSensitiveEnvironment(process.env))
    throw new Error(
      "Remove sensitive environment variables before building the legal site",
    );
  await rm(join(site, "static-out"), { recursive: true, force: true });
  for (const name of await readdir(site))
    if (name === ".env" || name.startsWith(".env."))
      throw new Error("Legal site must not have environment files");
  await rm(join(app, "(legal)"), { recursive: true, force: true });
  await rm(join(app, "layout.tsx"), { force: true });
  await rm(join(app, "globals.css"), { force: true });
  for (const source of allowedSources) {
    const target = join(app, source.slice("src/app/".length));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, source), target);
  }
  const binary = join(site, "node_modules/.bin/next");
  const child = spawnSync(binary, ["build", "--webpack"], {
    cwd: site,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "inherit",
  });
  if (child.error || child.status !== 0) throw new Error("Static build failed");
  const generated = join(site, "out");
  if (!(await stat(generated)).isDirectory())
    throw new Error("Static output missing");
  const pages = new Map();
  const css = new Map();
  for (const route of ["", "privacy", "terms", "data-deletion"]) {
    const source = join(generated, route, "index.html");
    let html = await readFile(source, "utf8");
    const styles = [
      ...html.matchAll(/href="(\/_next\/static\/css\/[a-zA-Z0-9_-]+\.css)"/g),
    ].map((match) => match[1]);
    if (styles.length === 0) throw new Error("Stylesheet missing from export");
    for (const href of styles) {
      if (!css.has(href))
        css.set(href, await readFile(join(generated, href.slice(1))));
    }
    html = html.replace(/<link\b[^>]*\bas="script"[^>]*\/?\s*>/gi, "");
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    if (/<script\b/i.test(html) || /_next\/static\/chunks\//.test(html))
      throw new Error("Script reference remains in export");
    pages.set(route, html);
  }
  const out = join(site, "static-out");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const [route, html] of pages) {
    const target = join(out, route, "index.html");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
  }
  for (const [href, bytes] of css) {
    const target = join(out, href.slice(1));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await rm(generated, { recursive: true, force: true });
  const files = await auditArtifact(out);
  process.stdout.write(`Static artifact audited: ${files.length} files\n`);
  for (const file of files)
    process.stdout.write(`${file.path}\t${file.bytes}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
