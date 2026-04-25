const state = {
  packages: []
};

const $ = (selector) => document.querySelector(selector);

const els = {
  uploadForm: $("#upload-form"),
  uploadButton: $("#upload-button"),
  packageTitle: $("#package-title"),
  packageSummary: $("#package-summary"),
  zipInput: $("#zip-input"),
  packageCount: $("#package-count"),
  packageSize: $("#package-size"),
  latestUpload: $("#latest-upload"),
  statusBanner: $("#status-banner"),
  searchInput: $("#search-input"),
  sortSelect: $("#sort-select"),
  statFiles: $("#stat-files"),
  statVisible: $("#stat-visible"),
  packageGrid: $("#package-grid"),
  packageCardTemplate: $("#package-card-template")
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function setStatus(message, tone = "info") {
  els.statusBanner.textContent = message;
  els.statusBanner.classList.remove("is-success", "is-error");
  if (tone === "success") els.statusBanner.classList.add("is-success");
  if (tone === "error") els.statusBanner.classList.add("is-error");
}

function getFilteredPackages() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const sort = els.sortSelect.value;

  const result = state.packages.filter((item) => {
    if (!keyword) return true;
    return item.title.toLowerCase().includes(keyword) || item.filename.toLowerCase().includes(keyword);
  });

  result.sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title, "zh-CN");
    if (sort === "size") return b.size - a.size;
    return b.uploadedAt - a.uploadedAt;
  });

  return result;
}

function renderStats(list) {
  const totalSize = state.packages.reduce((sum, item) => sum + item.size, 0);
  const latest = state.packages.length ? Math.max(...state.packages.map((item) => item.uploadedAt)) : 0;

  els.packageCount.textContent = String(state.packages.length);
  els.packageSize.textContent = formatBytes(totalSize);
  els.latestUpload.textContent = latest ? formatDate(latest) : "暂无";
  els.statFiles.textContent = String(state.packages.length);
  els.statVisible.textContent = String(list.length);
}

function renderPackages() {
  const list = getFilteredPackages();
  renderStats(list);

  if (!list.length) {
    els.packageGrid.innerHTML = `<div class="empty-state">${state.packages.length ? "没有匹配到对应的 ZIP 文件，换个关键词试试。" : "公开资源库还没有 ZIP，先上传第一个吧。"}</div>`;
    return;
  }

  els.packageGrid.innerHTML = "";

  list.forEach((item) => {
    const fragment = els.packageCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".package-card");
    const downloadButton = card.querySelector(".download-button");

    card.querySelector(".package-date").textContent = formatDate(item.uploadedAt);
    card.querySelector(".package-name").textContent = item.title;
    card.querySelector(".package-meta").textContent = `${item.summary || "公开 ZIP 资源。"} 文件名：${item.filename} | 文件大小：${formatBytes(item.size)}`;

    downloadButton.href = item.downloadUrl;
    downloadButton.download = item.filename;
    downloadButton.addEventListener("click", () => {
      setStatus(`开始下载：${item.filename}`, "success");
    });

    els.packageGrid.append(card);
  });
}

async function fetchPackages() {
  const response = await fetch("/api/packages", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载公开资源失败");
  }
  const data = await response.json();
  state.packages = data.packages;
  renderPackages();
}

async function handleUpload(event) {
  event.preventDefault();

  const file = els.zipInput.files?.[0];
  const title = els.packageTitle.value.trim();
  const summary = els.packageSummary.value.trim();

  if (!file) {
    setStatus("请先选择一个 ZIP 文件。", "error");
    return;
  }

  if (!file.name.toLowerCase().endsWith(".zip")) {
    setStatus("只允许上传 .zip 文件。", "error");
    return;
  }

  els.uploadButton.disabled = true;
  els.uploadButton.textContent = "上传中...";
  setStatus(`正在上传 ${file.name}，完成后会公开显示在资源列表中。`);

  try {
    const uploadUrl = new URL("/api/upload", window.location.origin);
    uploadUrl.searchParams.set("title", title);
    uploadUrl.searchParams.set("summary", summary);
    uploadUrl.searchParams.set("filename", file.name);

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/zip"
      },
      body: file
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "上传失败");
    }

    els.uploadForm.reset();
    await fetchPackages();
    setStatus(`上传成功：${data.package.filename} 已进入公开资源库。`, "success");
  } catch (error) {
    setStatus(error.message || "上传失败，请稍后重试。", "error");
  } finally {
    els.uploadButton.disabled = false;
    els.uploadButton.textContent = "上传并公开";
  }
}

function bindEvents() {
  els.uploadForm.addEventListener("submit", handleUpload);
  els.searchInput.addEventListener("input", renderPackages);
  els.sortSelect.addEventListener("change", renderPackages);
}

async function init() {
  bindEvents();
  setStatus("准备就绪，等待上传公开 ZIP。", "success");

  try {
    await fetchPackages();
  } catch {
    setStatus("无法连接上传服务，请用 node server.js 启动网站。", "error");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
