import http from "node:http";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT) || 3000;

const mimeByExt = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const pathname = new URL(String(req.url || "/"), "http://localhost").pathname;
  const requestPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalized = path.posix.normalize(requestPath);
  const filePath = path.join(__dirname, normalized);

  if (normalized.startsWith("..") || !filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const mime = mimeByExt[ext] || "text/plain; charset=utf-8";

  res.setHeader("Content-Type", mime);
  const stream = createReadStream(filePath);

  stream.on("error", () => {
    res.writeHead(404);
    res.end("Not found");
  });

  stream.pipe(res);
});

server.listen(port, () => {
  console.log(`Snake game running on http://localhost:${port}`);
});
