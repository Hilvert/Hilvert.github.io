const AVAILABLE_PACKAGES = [
  {
    id: "starter-pack",
    name: "starter-pack.zip",
    file: "./downloads/starter-pack.zip",
    size: 285,
    updatedAt: new Date("2026-04-18").getTime(),
    summary: "示例压缩包，演示网站只能下载代码中现成 ZIP 的模式。"
  },
  {
  id: "DSPBepInEx",
  name: "BepInEx5.zip",
  file: "./downloads/BepInEx5.zip",
  size: 606384,
  updatedAt: new Date("2026-04-18").getTime(),
  summary: "包含 BepInEx 的压缩包，用于做 【Unity 插件】。"
},
{
  id: "大鱼吃小鱼",
  name: "鱼吃鱼.zip",
  file: "./downloads/鱼吃鱼.zip",
  size: 72619112,
  updatedAt: new Date("2026-04-18").getTime(),
  summary: "大鱼吃小鱼【大鱼吃饭】。"
}
];

const state = {
  packages: [...AVAILABLE_PACKAGES]
};

const $ = (selector) => document.querySelector(selector);

const els = {
  packageCount: $("#package-count"),
  packageSize: $("#package-size"),
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

function setStatus(message) {
  els.statusBanner.textContent = message;
  els.statusBanner.classList.remove("is-success", "is-error");
}

function getFilteredPackages() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const sort = els.sortSelect.value;

  const result = state.packages.filter((item) => !keyword || item.name.toLowerCase().includes(keyword));

  result.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "zh-CN");
    if (sort === "size") return b.size - a.size;
    return b.updatedAt - a.updatedAt;
  });

  return result;
}

function renderStats(list) {
  const totalSize = state.packages.reduce((sum, item) => sum + item.size, 0);

  els.packageCount.textContent = String(state.packages.length);
  els.packageSize.textContent = formatBytes(totalSize);
  els.statFiles.textContent = String(state.packages.length);
  els.statVisible.textContent = String(list.length);
}

function renderPackages() {
  const list = getFilteredPackages();
  renderStats(list);

  if (!list.length) {
    const emptyText = state.packages.length
      ? "没有匹配到对应的 ZIP 文件，换个关键词试试。"
      : "当前代码里还没有配置任何 ZIP 文件。";
    els.packageGrid.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }

  els.packageGrid.innerHTML = "";

  list.forEach((item) => {
    const fragment = els.packageCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".package-card");
    const downloadButton = card.querySelector(".download-button");

    card.querySelector(".package-date").textContent = formatDate(item.updatedAt);
    card.querySelector(".package-name").textContent = item.name;
    card.querySelector(".package-meta").textContent =
      `${item.summary} 文件大小：${formatBytes(item.size)} | 更新时间：${formatDate(item.updatedAt)}`;

    downloadButton.href = item.file;
    downloadButton.download = item.name;
    downloadButton.addEventListener("click", () => {
      setStatus(`开始下载：${item.name}`);
    });

    els.packageGrid.append(card);
  });
}

function bindEvents() {
  els.searchInput.addEventListener("input", renderPackages);
  els.sortSelect.addEventListener("change", renderPackages);
}

function init() {
  bindEvents();
  renderPackages();
  setStatus("页面会提供代码中预设压缩包的下载按钮。");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
