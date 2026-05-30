import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || process.env.PAN_HOST || "127.0.0.1";
const STORAGE_ROOT = path.resolve(process.env.PAN_ROOT || path.join(__dirname, "storage"));
const PUBLIC_ROOT = path.join(__dirname, "public");
const CONFIG_PATH = path.join(__dirname, "config", "site.json");
const SECRET = process.env.PAN_SECRET || "change-this-secret-in-production";
const USE_X_ACCEL = ["1", "true", "yes"].includes(String(process.env.PAN_X_ACCEL || "").toLowerCase());
const X_ACCEL_PREFIX = normalizeAccelPrefix(process.env.PAN_X_ACCEL_PREFIX || "/_iboat_files/");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
  [".pdf", "application/pdf"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".md", "text/markdown; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".yml", "text/yaml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".apk", "application/vnd.android.package-archive"],
  [".zip", "application/zip"],
  [".txt", "text/plain; charset=utf-8"]
]);

const TEXT_PREVIEW_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
  ".htm",
  ".xml",
  ".yml",
  ".yaml",
  ".log",
  ".ini",
  ".conf",
  ".sql",
  ".sh",
  ".ps1"
]);

const defaultConfig = {
  title: "iBoat网盘",
  channelLabel: "关注TG频道",
  channelUrl: "",
  unlockMaxAgeSeconds: 1800,
  protected: {
    "加密文件夹": {
      password: "123456"
    }
  }
};

function normalizeAccelPrefix(prefix) {
  const normalized = `/${String(prefix || "").replace(/^\/+|\/+$/g, "")}/`;
  return normalized === "//" ? "/_iboat_files/" : normalized;
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return defaultConfig;
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function text(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
}

function makeToken(dir, maxAgeSeconds) {
  const maxAge = Number(maxAgeSeconds || defaultConfig.unlockMaxAgeSeconds);
  const payload = Buffer.from(JSON.stringify({ dir, exp: Date.now() + 1000 * maxAge })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token, dir) {
  if (!token || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  if (signature !== sign(payload)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.dir === dir && data.exp > Date.now();
  } catch {
    return false;
  }
}

function normalizeClientPath(input = "") {
  const decoded = decodeURIComponent(String(input).replaceAll("\\", "/"));
  const parts = decoded
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");

  if (parts.some((part) => part.startsWith("."))) {
    throw Object.assign(new Error("Hidden paths are not allowed"), { statusCode: 403 });
  }

  return parts.join("/");
}

function resolveStoragePath(clientPath = "") {
  const normalized = normalizeClientPath(clientPath);
  const absolute = path.resolve(STORAGE_ROOT, normalized);
  if (absolute !== STORAGE_ROOT && !absolute.startsWith(`${STORAGE_ROOT}${path.sep}`)) {
    throw new Error("Invalid path");
  }
  return { normalized, absolute };
}

function buildAccelPath(clientPath) {
  const encodedPath = normalizeClientPath(clientPath)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${X_ACCEL_PREFIX}${encodedPath}`;
}

function isProtectedPath(clientPath, protectedConfig) {
  const normalized = normalizeClientPath(clientPath);
  const match = Object.keys(protectedConfig || {}).find((dir) => {
    const protectedDir = normalizeClientPath(dir);
    return normalized === protectedDir || normalized.startsWith(`${protectedDir}/`);
  });
  return match ? normalizeClientPath(match) : "";
}

function passwordMatches(rule, password) {
  if (!rule) return false;
  if (rule.passwordHash) {
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(rule.passwordHash));
  }
  return typeof rule.password === "string" && rule.password === password;
}

function formatItem(name, clientPath, stats, type, config) {
  return {
    name,
    path: clientPath,
    type,
    locked: type === "folder" ? Boolean(isProtectedPath(clientPath, config.protected)) : false,
    size: type === "file" ? stats.size : null,
    modifiedAt: stats.mtime.toISOString()
  };
}

async function listDirectory(req, res, url, config) {
  const requestedPath = url.searchParams.get("path") || "";
  const { normalized, absolute } = resolveStoragePath(requestedPath);
  const realDirectoryPath = await fs.realpath(absolute);
  assertInsideStorageRealPath(realDirectoryPath);
  const protectedDir = isProtectedPath(normalized, config.protected);

  if (protectedDir && !verifyToken(parseCookies(req)[`pan_unlock_${encodeURIComponent(protectedDir)}`], protectedDir)) {
    return json(res, 423, {
      locked: true,
      path: normalized,
      protectedDir,
      title: config.title,
      channelLabel: config.channelLabel,
      channelUrl: config.channelUrl
    });
  }

  const stats = await fs.stat(realDirectoryPath);
  if (!stats.isDirectory()) {
    return json(res, 400, { error: "Path is not a directory" });
  }

  const entries = await fs.readdir(realDirectoryPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const itemPath = normalized ? `${normalized}/${entry.name}` : entry.name;
    const itemAbsolute = path.join(realDirectoryPath, entry.name);
    const itemRealPath = await fs.realpath(itemAbsolute);
    assertInsideStorageRealPath(itemRealPath);
    const itemStats = await fs.stat(itemRealPath);
    items.push(formatItem(entry.name, itemPath, itemStats, itemStats.isDirectory() ? "folder" : "file", config));
  }

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
  });

  json(res, 200, {
    title: config.title,
    channelLabel: config.channelLabel,
    channelUrl: config.channelUrl,
    path: normalized,
    parentPath: normalized.split("/").slice(0, -1).join("/"),
    protectedDir,
    items
  });
}

async function unlockDirectory(req, res, config) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 8192) req.destroy();
  });
  req.on("end", () => {
    try {
      const { path: clientPath, password } = JSON.parse(body || "{}");
      const protectedDir = isProtectedPath(clientPath, config.protected);
      const rule = config.protected?.[protectedDir];

      if (!protectedDir || !passwordMatches(rule, password || "")) {
        return json(res, 401, { ok: false, error: "密码不正确" });
      }

      const maxAge = Number(config.unlockMaxAgeSeconds || defaultConfig.unlockMaxAgeSeconds);
      const token = makeToken(protectedDir, maxAge);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `pan_unlock_${encodeURIComponent(protectedDir)}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
      });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      json(res, 400, { ok: false, error: "请求格式错误" });
    }
  });
}

async function forgetDirectory(req, res, config) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 8192) req.destroy();
  });
  req.on("end", () => {
    try {
      const { path: clientPath } = JSON.parse(body || "{}");
      const protectedDir = isProtectedPath(clientPath, config.protected);
      if (!protectedDir) return json(res, 200, { ok: true });

      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `pan_unlock_${encodeURIComponent(protectedDir)}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
      });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      json(res, 400, { ok: false, error: "请求格式错误" });
    }
  });
}

async function downloadFile(req, res, url, config) {
  const { normalized, realFilePath, stats } = await resolveReadableFile(req, url, config);

  const filename = path.basename(realFilePath);
  const headers = {
    "content-type": MIME_TYPES.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "last-modified": stats.mtime.toUTCString()
  };

  if (USE_X_ACCEL) {
    res.writeHead(200, {
      ...headers,
      "x-accel-redirect": buildAccelPath(normalized),
      "x-accel-buffering": "yes"
    });
    return res.end();
  }

  res.writeHead(200, {
    ...headers,
    "content-length": stats.size
  });
  createReadStream(realFilePath).pipe(res);
}

async function resolveReadableFile(req, url, config) {
  const requestedPath = url.searchParams.get("path") || "";
  const { normalized, absolute } = resolveStoragePath(requestedPath);
  const realFilePath = await fs.realpath(absolute);
  assertInsideStorageRealPath(realFilePath);
  const protectedDir = isProtectedPath(normalized, config.protected);

  if (protectedDir && !verifyToken(parseCookies(req)[`pan_unlock_${encodeURIComponent(protectedDir)}`], protectedDir)) {
    throw Object.assign(new Error("This file is protected."), { statusCode: 403 });
  }

  const stats = await fs.stat(realFilePath);
  if (!stats.isFile()) {
    throw Object.assign(new Error("Not a file."), { statusCode: 400 });
  }

  return { normalized, realFilePath, stats };
}

function parseRangeHeader(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || "");
  if (!match) return null;

  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);

  if (start === null && end === null) return null;
  if (start === null) {
    start = Math.max(size - end, 0);
    end = size - 1;
  } else if (end === null) {
    end = size - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

async function previewFile(req, res, url, config) {
  const { normalized, realFilePath, stats } = await resolveReadableFile(req, url, config);

  const filename = path.basename(realFilePath);
  const extension = path.extname(filename).toLowerCase();
  const contentType = TEXT_PREVIEW_EXTENSIONS.has(extension)
    ? "text/plain; charset=utf-8"
    : MIME_TYPES.get(extension) || "application/octet-stream";
  const headers = {
    "content-type": contentType,
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "last-modified": stats.mtime.toUTCString(),
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff"
  };

  if (USE_X_ACCEL) {
    res.writeHead(200, {
      ...headers,
      "x-accel-redirect": buildAccelPath(normalized),
      "x-accel-buffering": "yes"
    });
    return res.end();
  }

  const range = parseRangeHeader(req.headers.range, stats.size);
  if (req.headers.range && !range) {
    res.writeHead(416, {
      "content-range": `bytes */${stats.size}`,
      "accept-ranges": "bytes"
    });
    return res.end();
  }

  if (range) {
    res.writeHead(206, {
      ...headers,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${stats.size}`
    });
    return createReadStream(realFilePath, range).pipe(res);
  }

  res.writeHead(200, {
    ...headers,
    "content-length": stats.size
  });
  createReadStream(realFilePath).pipe(res);
}

async function serveStatic(res, pathname) {
  const filePath = pathname === "/" ? path.join(PUBLIC_ROOT, "index.html") : path.resolve(PUBLIC_ROOT, `.${pathname}`);
  if (filePath !== PUBLIC_ROOT && !filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
    return text(res, 403, "Forbidden");
  }
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return text(res, 404, "Not found");
    res.writeHead(200, {
      "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "cache-control": "no-store"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    text(res, 404, "Not found");
  }
}

async function serveIndex(res) {
  const filePath = path.join(PUBLIC_ROOT, "index.html");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

await fs.mkdir(STORAGE_ROOT, { recursive: true });
const STORAGE_REAL_ROOT = await fs.realpath(STORAGE_ROOT);

function assertInsideStorageRealPath(realPath) {
  if (realPath !== STORAGE_REAL_ROOT && !realPath.startsWith(`${STORAGE_REAL_ROOT}${path.sep}`)) {
    throw Object.assign(new Error("Path escapes storage root"), { statusCode: 403 });
  }
}

http
  .createServer(async (req, res) => {
    const config = await loadConfig();
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
      if (USE_X_ACCEL && url.pathname.startsWith(X_ACCEL_PREFIX)) return text(res, 404, "Not found");
      if (req.method === "GET" && url.pathname === "/api/list") return await listDirectory(req, res, url, config);
      if (req.method === "POST" && url.pathname === "/api/unlock") return await unlockDirectory(req, res, config);
      if (req.method === "POST" && url.pathname === "/api/forget") return await forgetDirectory(req, res, config);
      if (req.method === "GET" && url.pathname === "/download") return await downloadFile(req, res, url, config);
      if (req.method === "GET" && url.pathname === "/preview") return await previewFile(req, res, url, config);
      if (req.method === "GET" || req.method === "HEAD") {
        if (url.pathname === "/" || url.pathname.startsWith("/icons/") || ["/app.js", "/styles.css"].includes(url.pathname)) {
          return await serveStatic(res, url.pathname);
        }
        return await serveIndex(res);
      }
      text(res, 405, "Method not allowed");
    } catch (error) {
      const status = error.statusCode || (error.code === "ENOENT" ? 404 : 500);
      json(res, status, { error: status === 404 ? "Not found" : status === 403 ? "Forbidden" : "Server error" });
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`iBoat网盘 running at http://${HOST}:${PORT}`);
    console.log(`Storage root: ${STORAGE_ROOT}`);
    console.log(`Storage real root: ${STORAGE_REAL_ROOT}`);
  });
