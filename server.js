const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DOWNLOADS_DIR = path.join(ROOT, "downloads");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "packages.db");
const LEGACY_META_PATH = path.join(DATA_DIR, "package-meta.json");
const MAX_BODY_SIZE = 200 * 1024 * 1024;

function ensureStorage() {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readLegacyMeta() {
  if (!fs.existsSync(LEGACY_META_PATH)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(LEGACY_META_PATH, "utf8"));
  } catch {
    return {};
  }
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sanitizeFilename(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  const base = path.basename(filename || "", ext);
  const safeBase = base.replace(/[\\/:*?"<>|]/g, "-").trim() || "package";
  return `${safeBase}${ext || ".zip"}`;
}

function ensureUniqueFilename(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let nextName = filename;
  let counter = 1;

  while (fs.existsSync(path.join(DOWNLOADS_DIR, nextName))) {
    counter += 1;
    nextName = `${base}-${counter}${ext}`;
  }

  return nextName;
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".zip": "application/zip"
  }[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      json(res, 404, { error: "文件不存在" });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

function readBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_SIZE) {
        reject(new Error("上传文件过大，请控制在 200MB 内。"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", () => reject(new Error("读取上传请求失败。")));
  });
}

ensureStorage();

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_at INTEGER NOT NULL
  ) STRICT
`);

const listPackagesStmt = db.prepare(`
  SELECT id, filename, title, summary, size, uploaded_at
  FROM packages
  ORDER BY uploaded_at DESC
`);

const getPackageByFilenameStmt = db.prepare(`
  SELECT id, filename, title, summary, size, uploaded_at
  FROM packages
  WHERE filename = ?
`);

const upsertPackageStmt = db.prepare(`
  INSERT INTO packages (id, filename, title, summary, size, uploaded_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(filename) DO UPDATE SET
    size = excluded.size,
    uploaded_at = excluded.uploaded_at
`);

const insertPackageStmt = db.prepare(`
  INSERT INTO packages (id, filename, title, summary, size, uploaded_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const deletePackageStmt = db.prepare(`
  DELETE FROM packages
  WHERE filename = ?
`);

function rowToPublicPackage(row) {
  return {
    id: row.id,
    filename: row.filename,
    title: row.title,
    summary: row.summary,
    size: row.size,
    uploadedAt: row.uploaded_at,
    downloadUrl: `/downloads/${encodeURIComponent(row.filename)}`
  };
}

function syncPackagesFromDisk() {
  const legacyMeta = readLegacyMeta();
  const diskFiles = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".zip")
    .map((entry) => entry.name);

  const diskSet = new Set(diskFiles);
  const dbRows = listPackagesStmt.all();

  for (const row of dbRows) {
    if (!diskSet.has(row.filename)) {
      deletePackageStmt.run(row.filename);
    }
  }

  for (const filename of diskFiles) {
    const filePath = path.join(DOWNLOADS_DIR, filename);
    const stats = fs.statSync(filePath);
    const existing = getPackageByFilenameStmt.get(filename);
    const legacy = legacyMeta[filename] || {};
    const uploadedAt = Math.floor(Number(existing?.uploaded_at || legacy.uploadedAt || stats.mtimeMs));
    const title = String(existing?.title || legacy.title || path.basename(filename, ".zip"));
    const summary = String(existing?.summary || legacy.summary || "公开 ZIP 资源。");
    const id = String(existing?.id || legacy.id || `${filename}-${uploadedAt}`);

    upsertPackageStmt.run(id, filename, title, summary, stats.size, uploadedAt);
  }
}

function loadPackages() {
  syncPackagesFromDisk();
  return listPackagesStmt.all().map(rowToPublicPackage);
}

async function handleUpload(req, res, requestUrl) {
  try {
    const title = String(requestUrl.searchParams.get("title") || "").trim();
    const summary = String(requestUrl.searchParams.get("summary") || "").trim();
    const filename = String(requestUrl.searchParams.get("filename") || "").trim();

    if (!filename || !filename.toLowerCase().endsWith(".zip")) {
      json(res, 400, { error: "只允许上传 .zip 文件。" });
      return;
    }

    const fileBuffer = await readBinaryBody(req);
    if (!fileBuffer.length) {
      json(res, 400, { error: "上传内容为空。" });
      return;
    }

    const safeName = ensureUniqueFilename(sanitizeFilename(filename));
    const savedPath = path.join(DOWNLOADS_DIR, safeName);
    fs.writeFileSync(savedPath, fileBuffer);

    const uploadedAt = Date.now();
    const stats = fs.statSync(savedPath);
    const packageId = `${safeName}-${uploadedAt}`;

    insertPackageStmt.run(
      packageId,
      safeName,
      title || path.basename(safeName, ".zip"),
      summary || "公开 ZIP 资源。",
      stats.size,
      uploadedAt
    );

    const packageItem = rowToPublicPackage(getPackageByFilenameStmt.get(safeName));
    json(res, 201, { package: packageItem });
  } catch (error) {
    json(res, 500, { error: error.message || "上传失败。" });
  }
}

function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (req.method === "GET" && pathname === "/api/packages") {
    json(res, 200, { packages: loadPackages() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/upload") {
    handleUpload(req, res, requestUrl);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/downloads/")) {
    const relative = pathname.replace(/^\/downloads\//, "");
    const filePath = path.join(DOWNLOADS_DIR, relative);
    if (!filePath.startsWith(DOWNLOADS_DIR)) {
      json(res, 403, { error: "无权访问该文件。" });
      return;
    }
    serveFile(res, filePath);
    return;
  }

  const staticPath = pathname === "/" ? path.join(ROOT, "index.html") : path.join(ROOT, pathname);
  if (staticPath.startsWith(ROOT) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    serveFile(res, staticPath);
    return;
  }

  json(res, 404, { error: "未找到对应页面。" });
}

syncPackagesFromDisk();

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`ZIP upload server is running at http://localhost:${PORT}`);
});
