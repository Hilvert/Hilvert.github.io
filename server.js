const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DOWNLOADS_DIR = path.join(ROOT, "downloads");
const META_PATH = path.join(ROOT, "data", "package-meta.json");
const MAX_BODY_SIZE = 200 * 1024 * 1024;

function ensureStorage() {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(META_PATH), { recursive: true });
  if (!fs.existsSync(META_PATH)) {
    fs.writeFileSync(META_PATH, "{}\n", "utf8");
  }
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeMeta(meta) {
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf8");
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

function publicPackageFromFile(file, metaMap) {
  const filePath = path.join(DOWNLOADS_DIR, file.name);
  const stats = fs.statSync(filePath);
  const meta = metaMap[file.name] || {};
  const uploadedAt = meta.uploadedAt || stats.mtimeMs;
  return {
    id: meta.id || `${file.name}-${Math.floor(uploadedAt)}`,
    filename: file.name,
    title: meta.title || path.basename(file.name, path.extname(file.name)),
    summary: meta.summary || "公开 ZIP 资源。",
    size: stats.size,
    uploadedAt,
    downloadUrl: `/downloads/${encodeURIComponent(file.name)}`
  };
}

function loadPackages() {
  const metaMap = readMeta();
  const files = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".zip")
    .map((entry) => publicPackageFromFile(entry, metaMap));

  files.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return files;
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

function readJsonBody(req) {
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
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求数据不是有效的 JSON。"));
      }
    });

    req.on("error", () => reject(new Error("读取上传请求失败。")));
  });
}

async function handleUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const title = String(body.title || "").trim();
    const summary = String(body.summary || "").trim();
    const filename = String(body.filename || "").trim();
    const base64 = String(body.contentBase64 || "").trim();

    if (!filename || !filename.toLowerCase().endsWith(".zip")) {
      json(res, 400, { error: "只允许上传 .zip 文件。" });
      return;
    }

    if (!base64) {
      json(res, 400, { error: "上传内容为空。" });
      return;
    }

    const safeName = ensureUniqueFilename(sanitizeFilename(filename));
    const fileBuffer = Buffer.from(base64, "base64");
    if (!fileBuffer.length) {
      json(res, 400, { error: "无法解析 ZIP 内容。" });
      return;
    }

    const savedPath = path.join(DOWNLOADS_DIR, safeName);
    fs.writeFileSync(savedPath, fileBuffer);

    const uploadedAt = Date.now();
    const meta = readMeta();
    meta[safeName] = {
      id: `${safeName}-${uploadedAt}`,
      title: title || path.basename(safeName, ".zip"),
      summary: summary || "公开 ZIP 资源。",
      uploadedAt
    };
    writeMeta(meta);

    const packageItem = publicPackageFromFile({ name: safeName }, meta);
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
    handleUpload(req, res);
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

ensureStorage();

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`ZIP upload server is running at http://localhost:${PORT}`);
});
