const state = {
  path: readPathFromLocation(),
  pendingLockedPath: "",
  protectedDir: "",
  previewRequestId: 0
};

const els = {
  title: document.querySelector("[data-title]"),
  home: document.querySelector("[data-home]"),
  channel: document.querySelector("[data-channel]"),
  channelLabel: document.querySelector("[data-channel-label]"),
  breadcrumbs: document.querySelector("[data-breadcrumbs]"),
  back: document.querySelector("[data-back]"),
  refresh: document.querySelector("[data-refresh]"),
  heading: document.querySelector("[data-heading]"),
  subheading: document.querySelector("[data-subheading]"),
  list: document.querySelector("[data-list]"),
  empty: document.querySelector("[data-empty]"),
  dialog: document.querySelector("[data-dialog]"),
  unlockForm: document.querySelector("[data-unlock-form]"),
  password: document.querySelector("[data-password]"),
  error: document.querySelector("[data-error]"),
  cancel: document.querySelector("[data-cancel]"),
  previewDialog: document.querySelector("[data-preview-dialog]"),
  previewTitle: document.querySelector("[data-preview-title]"),
  previewMeta: document.querySelector("[data-preview-meta]"),
  previewIcon: document.querySelector("[data-preview-icon]"),
  previewBody: document.querySelector("[data-preview-body]"),
  previewDownload: document.querySelector("[data-preview-download]"),
  previewClose: document.querySelector("[data-preview-close]")
};

document.querySelector("[data-year]").textContent = new Date().getFullYear();

function setPath(nextPath, replace = false) {
  navigateTo(nextPath || "", replace);
}

function readPathFromLocation() {
  return decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, "");
}

function urlForPath(clientPath) {
  if (!clientPath) return "/";
  return `/${clientPath
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function isInsidePath(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

async function lockCurrentIfLeaving(nextPath) {
  if (!state.protectedDir || isInsidePath(state.protectedDir, nextPath)) return;
  await fetch("/api/forget", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: state.protectedDir })
  });
  state.protectedDir = "";
}

async function navigateTo(nextPath, replace = false) {
  state.path = nextPath || "";
  await lockCurrentIfLeaving(state.path);
  const url = urlForPath(state.path);
  history[replace ? "replaceState" : "pushState"]({ path: state.path }, "", url);
  loadDirectory();
}

function formatSize(bytes) {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function renderBreadcrumbs(path) {
  els.breadcrumbs.innerHTML = "";
  const parts = path ? path.split("/") : [];
  const isCompact = window.matchMedia("(max-width: 640px)").matches;
  const visibleParts =
    (isCompact && parts.length > 2) || (!isCompact && parts.length > 5)
      ? [
          { label: "首页", path: "" },
          { label: "...", path: null },
          ...parts.slice(isCompact ? -2 : -4).map((part, index, visible) => {
            const startIndex = parts.length - visible.length + index;
            return {
              label: part,
              path: parts.slice(0, startIndex + 1).join("/")
            };
          })
        ]
      : [
          { label: "首页", path: "" },
          ...parts.map((part, index) => ({
            label: part,
            path: parts.slice(0, index + 1).join("/")
          }))
        ];

  visibleParts.forEach((crumb, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "crumb-separator";
      separator.textContent = "/";
      els.breadcrumbs.append(separator);
    }

    if (crumb.path === null) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "crumb crumb-static";
      ellipsis.textContent = crumb.label;
      els.breadcrumbs.append(ellipsis);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "crumb";
    button.textContent = crumb.label;
    button.addEventListener("click", () => setPath(crumb.path));
    els.breadcrumbs.append(button);
  });

  els.breadcrumbs.scrollLeft = els.breadcrumbs.scrollWidth;
}

function rerenderCurrentBreadcrumbs() {
  renderBreadcrumbs(state.path);
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const fileIconGroups = [
  { icon: "zip", extensions: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"] },
  { icon: "img", extensions: ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico", "svg"] },
  { icon: "video", extensions: ["mp4", "mkv", "mov", "avi", "wmv", "flv", "webm", "m4v", "ts"] },
  { icon: "audio", extensions: ["mp3", "flac", "wav", "aac", "ogg", "m4a", "ape"] },
  { icon: "pdf", extensions: ["pdf"] },
  { icon: "txt", extensions: ["txt", "md", "rtf", "epub", "log", "ini", "conf"] },
  { icon: "word", extensions: ["doc", "docx"] },
  { icon: "ppt", extensions: ["ppt", "pptx", "pps", "ppsx"] },
  { icon: "excel", extensions: ["xls", "xlsx", "csv", "tsv"] },
  { icon: "code", extensions: ["js", "mjs", "ts", "tsx", "jsx", "html", "css", "json", "xml", "yml", "yaml", "php", "py", "java", "go", "rs", "c", "cpp", "h", "sh", "ps1", "sql"] },
  { icon: "android", extensions: ["apk", "apks", "xapk"] },
  { icon: "win11", extensions: ["exe", "msi", "msix", "bat", "cmd", "reg"] },
  { icon: "apple", extensions: ["dmg", "pkg", "ipa", "app"] }
];

function iconId(name) {
  return `#iboat-${name}`;
}

function createSymbolIcon(name, className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add(className, "symbol-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", iconId(name));
  use.setAttributeNS(XLINK_NS, "href", iconId(name));
  svg.append(use);
  return svg;
}

function setSymbolIcon(svg, name) {
  const href = iconId(name);
  const use = svg.querySelector("use");
  if (!use) return;
  use.setAttribute("href", href);
  use.setAttributeNS(XLINK_NS, "href", href);
}

function iconForFile(name) {
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const match = fileIconGroups.find((group) => group.extensions.includes(extension));
  return match?.icon || "file";
}

function fileExtension(name) {
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

function downloadUrl(clientPath) {
  return `/download?path=${encodeURIComponent(clientPath)}`;
}

function previewUrl(clientPath) {
  return `/preview?path=${encodeURIComponent(clientPath)}`;
}

function previewKind(name) {
  const extension = fileExtension(name);
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico", "svg"].includes(extension)) return "image";
  if (["txt", "md", "json", "js", "mjs", "ts", "tsx", "jsx", "css", "html", "htm", "xml", "yml", "yaml", "log", "ini", "conf", "sql", "sh", "ps1"].includes(extension)) return "text";
  if (extension === "pdf") return "pdf";
  if (["mp3", "wav", "ogg", "m4a"].includes(extension)) return "audio";
  if (["mp4", "webm", "mov"].includes(extension)) return "video";
  return "unsupported";
}

function setPreviewMessage(message) {
  const empty = document.createElement("div");
  empty.className = "preview-message";
  empty.textContent = message;
  els.previewBody.replaceChildren(empty);
}

async function openPreview(item) {
  const requestId = ++state.previewRequestId;
  const url = previewUrl(item.path);
  const kind = previewKind(item.name);

  if (kind === "unsupported") {
    location.href = downloadUrl(item.path);
    return;
  }

  els.previewTitle.textContent = item.name;
  els.previewMeta.textContent = `${formatSize(item.size)} · ${formatDate(item.modifiedAt)}`;
  setSymbolIcon(els.previewIcon, iconForFile(item.name));
  els.previewDownload.href = downloadUrl(item.path);
  els.previewDownload.download = item.name;
  els.previewBody.innerHTML = "";
  els.previewDialog.showModal();

  if (kind === "image") {
    const image = document.createElement("img");
    image.className = "preview-image";
    image.src = url;
    image.alt = item.name;
    els.previewBody.replaceChildren(image);
    return;
  }

  if (kind === "pdf") {
    const frame = document.createElement("iframe");
    frame.className = "preview-frame";
    frame.src = url;
    frame.title = item.name;
    els.previewBody.replaceChildren(frame);
    return;
  }

  if (kind === "audio") {
    const audio = document.createElement("audio");
    audio.className = "preview-media";
    audio.src = url;
    audio.controls = true;
    audio.preload = "metadata";
    els.previewBody.replaceChildren(audio);
    return;
  }

  if (kind === "video") {
    const video = document.createElement("video");
    video.className = "preview-video";
    video.src = url;
    video.controls = true;
    video.preload = "metadata";
    els.previewBody.replaceChildren(video);
    return;
  }

  setPreviewMessage("正在加载预览...");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Preview failed");
    const content = await response.text();
    if (requestId !== state.previewRequestId) return;
    const pre = document.createElement("pre");
    pre.className = "preview-text";
    pre.textContent = content;
    els.previewBody.replaceChildren(pre);
  } catch {
    if (requestId === state.previewRequestId) {
      setPreviewMessage("预览加载失败，可以直接下载。");
    }
  }
}

function renderItems(items) {
  els.list.innerHTML = "";
  els.empty.hidden = items.length !== 0;

  for (const item of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "file-row";
    row.addEventListener("click", () => {
      if (item.type === "folder") {
        setPath(item.path);
      } else {
        openPreview(item);
      }
    });

    const icon = createSymbolIcon(
      item.type === "folder" ? (item.locked ? "folder-locked" : "folder") : iconForFile(item.name),
      "item-icon"
    );

    const main = document.createElement("span");
    main.className = "item-main";

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = item.name;

    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.innerHTML =
      item.type === "folder"
        ? `<span>文件夹</span><span>${formatDate(item.modifiedAt)}</span>`
        : `<span>${formatSize(item.size)}</span><span>${formatDate(item.modifiedAt)}</span>`;

    const action = document.createElement("span");
    action.className = "file-action";
    action.setAttribute("aria-hidden", "true");
    action.append(createSymbolIcon(item.type === "folder" ? "chevron-right" : "download", "file-action-icon"));

    main.append(name, meta);
    row.append(icon, main, action);
    els.list.append(row);
  }
}

function applySiteMeta(data) {
  document.title = data.title || "iBoat网盘";
  els.title.textContent = data.title || "iBoat网盘";
  if (data.channelUrl) {
    els.channel.href = data.channelUrl;
    els.channelLabel.textContent = data.channelLabel || "关注频道";
    els.channel.hidden = false;
  } else {
    els.channel.hidden = true;
  }
}

async function loadDirectory() {
  els.back.disabled = !state.path;

  const response = await fetch(`/api/list?path=${encodeURIComponent(state.path)}`);
  const data = await response.json();
  applySiteMeta(data);

  if (response.status === 423) {
    state.pendingLockedPath = data.path;
    els.dialog.showModal();
    els.password.value = "";
    els.error.textContent = "";
    els.password.focus();
    return;
  }

  if (!response.ok) {
    return;
  }

  renderBreadcrumbs(data.path);
  renderItems(data.items);
  state.protectedDir = data.protectedDir || "";
  els.heading.textContent = data.path ? data.path.split("/").at(-1) : "全部文件";
  els.subheading.textContent = `${data.items.length} 个项目`;
}

els.home.addEventListener("click", (event) => {
  event.preventDefault();
  setPath("");
});

els.back.addEventListener("click", () => {
  if (!state.path) return;
  setPath(state.path.split("/").slice(0, -1).join("/"));
});

els.refresh.addEventListener("click", () => loadDirectory());

els.cancel.addEventListener("click", () => {
  els.dialog.close();
  setPath(state.pendingLockedPath.split("/").slice(0, -1).join("/"));
});

els.previewClose.addEventListener("click", () => {
  state.previewRequestId += 1;
  els.previewDialog.close();
  els.previewBody.innerHTML = "";
});

els.previewDialog.addEventListener("close", () => {
  state.previewRequestId += 1;
  els.previewBody.innerHTML = "";
});

els.unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.error.textContent = "";
  const response = await fetch("/api/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: state.pendingLockedPath, password: els.password.value })
  });
  const data = await response.json();
  if (!data.ok) {
    els.error.textContent = data.error || "解密失败";
    return;
  }
  els.dialog.close();
  loadDirectory();
});

window.addEventListener("popstate", async () => {
  const nextPath = readPathFromLocation();
  await lockCurrentIfLeaving(nextPath);
  state.path = nextPath;
  loadDirectory();
});

window.addEventListener("resize", rerenderCurrentBreadcrumbs);

loadDirectory();
