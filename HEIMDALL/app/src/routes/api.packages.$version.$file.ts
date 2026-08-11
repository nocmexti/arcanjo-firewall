import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/packages/$version/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => servePackage(params.version, params.file),
    },
  },
});

const allowedVersions = new Set(["2.5", "2.6", "2.7", "2.8"]);

async function servePackage(version: string, file: string) {
  if (!allowedVersions.has(version) || !/^[A-Za-z0-9._-]+\.(pkg|txz)$/.test(file)) {
    return new Response("not found", { status: 404 });
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = process.env["HEIMDALL_PACKAGE_DIR"] ?? "/app/.output/public/api/packages";
  const base = path.resolve(root);
  const target = path.resolve(base, version, file);
  if (!target.startsWith(base + path.sep)) {
    return new Response("not found", { status: 404 });
  }

  try {
    const content = await fs.readFile(target);
    return new Response(content, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${file}"`,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
