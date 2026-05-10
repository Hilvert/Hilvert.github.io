const config = window.APP_CONFIG || {};
const hasConfig = Boolean(
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  !config.supabaseUrl.includes("YOUR-PROJECT-ID") &&
  !config.supabaseAnonKey.includes("YOUR_SUPABASE_ANON_KEY")
);

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

const supabase = hasConfig
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

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

function normalizePackage(row) {
  const bucketName = config.bucketName || "zip-files";
  const { data } = supabase.storage.from(bucketName).getPublicUrl(row.file_path);
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    filename: row.filename,
    size: Number(row.size) || 0,
    uploadedAt: row.uploaded_at,
    downloadUrl: data.publicUrl
  };
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
    return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
  });

  return result;
}

function renderStats(list) {
  const totalSize = state.packages.reduce((sum, item) => sum + item.size, 0);
  const latest = state.packages.length
    ? Math.max(...state.packages.map((item) => new Date(item.uploadedAt).getTime()))
    : 0;

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
  const tableName = config.packagesTable || "packages";
  const { data, error } = await supabase
    .from(tableName)
    .select("id, title, summary, filename, file_path, size, uploaded_at")
    .order("uploaded_at", { ascending: false });

  if (error) {
    throw error;
  }

  state.packages = (data || []).map(normalizePackage);
  renderPackages();
}

async function handleUpload(event) {
  event.preventDefault();

  const file = els.zipInput.files?.[0];
  const title = els.packageTitle.value.trim();
  const summary = els.packageSummary.value.trim();
  const bucketName = config.bucketName || "zip-files";
  const tableName = config.packagesTable || "packages";

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
  setStatus(`正在上传 ${file.name} 到 Supabase，请稍候。`);

  try {
    const safeName = `${Date.now()}-${file.name}`.replace(/[^\w\-.一-龥]/g, "-");
    const filePath = `public/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/zip"
      });

    if (uploadError) {
      throw uploadError;
    }

    const payload = {
      title: title || file.name.replace(/\.zip$/i, ""),
      summary: summary || "公开 ZIP 资源。",
      filename: file.name,
      file_path: filePath,
      size: file.size
    };

    const { error: insertError } = await supabase.from(tableName).insert(payload);
    if (insertError) {
      throw insertError;
    }

    els.uploadForm.reset();
    await fetchPackages();
    setStatus(`上传成功：${file.name} 已进入公开资源库。`, "success");
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

  if (!hasConfig || !supabase) {
    setStatus("请先打开 config.js，填入 Supabase 项目地址和匿名 key。", "error");
    return;
  }

  setStatus("已连接 Supabase，正在读取公开资源列表。", "success");

  try {
    await fetchPackages();
  } catch (error) {
    setStatus(`连接 Supabase 失败：${error.message || "请检查配置和表结构。"}`, "error");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
