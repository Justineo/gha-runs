import "./style.css";

// Constants
const MAX_DURATION = 12 * 60 * 60; // 12 hours in seconds
const REPO_CONFIG = {
  "Kong/konnect-ui-apps": {
    branch: "main",
  },
  "Kong/public-ui-components": {
    branch: "main",
  },
  "Kong/shared-ui-components": {
    branch: "main",
  },
  "Kong/kongponents": {
    branch: "main",
  },
  "Kong/kong-admin": {
    branch: "master",
    workflow: "Build, Test & Release",
  },
  "Kong/kong-manager": {
    branch: "main",
  },
};

// Gloabal
let GITHUB_TOKEN = "";

// DOM Elements
const chartContainer = document.getElementById("chart-container");
const mainElement = document.querySelector("main");
const statusFilters = {
  success: document.getElementById("filter-success"),
  failure: document.getElementById("filter-failure"),
  cancelled: document.getElementById("filter-cancelled"),
  pending: document.getElementById("filter-pending"),
  in_progress: document.getElementById("filter-in-progress"),
};
const attemptOneOnlyCheckbox = document.getElementById("attempt-one-only");
const countLimitInput = document.getElementById("count-limit");
const repositorySelect = document.getElementById("repository-select");
const refreshButton = document.getElementById("refresh-button");
const searchInput = document.getElementById("search-input");
const updateTimeElement = document.getElementById("update-time");
const failureRateElement = document.getElementById("failure-rate");

// State variables
let repository = repositorySelect.value;
let data = [];
let showStatus = {
  success: statusFilters.success.checked,
  failure: statusFilters.failure.checked,
  cancelled: statusFilters.cancelled.checked,
  pending: statusFilters.pending.checked,
  in_progress: statusFilters.in_progress.checked,
};
let attemptOneOnly = attemptOneOnlyCheckbox.checked;
let runsToShow = parseInt(countLimitInput.value, 10) || 100;
let searchRegExp = null;

// Utility Functions
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds = Math.floor(seconds % 60);
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function encodeHTML(str) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "`": "&#96;",
  };
  return str.replace(/[&<>"'`]/g, (match) => map[match]);
}

function buildHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

const tokenInput = document.getElementById("github-token-input");

async function fetchRuns() {
  const baseUrl = `https://api.github.com/repos/${repository}/actions/runs`;
  const config = REPO_CONFIG[repository];
  const params = new URLSearchParams({
    branch: config.branch,
    event: "push",
    per_page: "100",
  });
  const pages = [1, 2, 3, 4, 5, 6];

  GITHUB_TOKEN = localStorage.getItem("GITHUB_TOKEN") || "";

  if (!GITHUB_TOKEN) {
    const dialog = document.getElementById("pat");
    dialog.showModal();

    return new Promise((resolve) => {
      dialog.addEventListener("cancel", (event) => {
        tokenInput.focus();
      });
      dialog.addEventListener("close", async () => {
        if (tokenInput && tokenInput.value) {
          GITHUB_TOKEN = tokenInput.value;
          localStorage.setItem("GITHUB_TOKEN", GITHUB_TOKEN);
          const runs = await fetchRuns(); // Retry fetching runs after token is provided

          resolve(runs);
        } else {
          resolve([]);
        }
      });
    });
  }

  try {
    const fetchPage = async (page) => {
      params.set("page", page.toString());
      const url = `${baseUrl}?${params.toString()}`;
      const response = await fetch(url, {
        headers: buildHeaders(),
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Error fetching page ${page}: ${response.statusText}`);
      }
      const data = await response.json();
      return data.workflow_runs || [];
    };

    const results = await Promise.all(pages.map(fetchPage));
    const runs = results.flat();
    if (config.workflow) {
      return runs.filter((run) => run.name === config.workflow);
    }
    return runs;
  } catch (error) {
    console.error("Error fetching data:", error);
    return [];
  }
}

function parseRunData(run) {
  const id = run.id;
  const url = run.html_url;
  const startTime = new Date(run.run_started_at);
  const endTime = new Date(run.updated_at);
  const duration = (endTime - startTime) / 1000;
  const attempt = run.run_attempt;
  const status = run.conclusion || run.status;
  const symbolMap = {
    success: "✅",
    failure: "❌",
    pending: "⏳",
    in_progress: "🔄",
    cancelled: "🚫",
  };
  const symbol = symbolMap[status] || "❔";

  const urlParams = new URLSearchParams(window.location.search);
  const mark =
    urlParams.get("compare") === "true" &&
    (run.id === 10918116942 || run.id === 10860108600);

  const title = run.display_title;
  return { id, title, url, duration, attempt, status, mark, symbol };
}

async function loadData() {
  data = (await fetchRuns()).map(parseRunData);
  updateTimeElement.textContent = new Date().toLocaleString();
}

function filterData() {
  let filteredData = data.filter((item) => item.duration <= MAX_DURATION);

  if (searchRegExp) {
    filteredData = filteredData.filter((item) => searchRegExp.test(item.title));
  }

  filteredData = filteredData.map((item) => {
    const result = { ...item, show: true, valid: true };
    if (
      !showStatus[result.status] ||
      (attemptOneOnly && result.attempt !== 1)
    ) {
      result.valid = false;
      result.show = result.mark;
    }
    return result;
  });

  return filteredData.filter((item) => item.show).slice(0, runsToShow);
}

function render() {
  chartContainer.innerHTML = "";
  const filteredData = filterData();
  const maxDuration = Math.max(...filteredData.map((item) => item.duration));

  const successCount = filteredData.filter(
    (item) => item.status === "success"
  ).length;
  const failureCount = filteredData.filter(
    (item) => item.status === "failure"
  ).length;
  const failureRatio =
    showStatus.success && showStatus.failure
      ? failureCount / (successCount + failureCount)
      : null;

  filteredData.forEach((item) => {
    const bar = document.createElement("div");
    bar.classList.add("bar", item.status.replace("_", "-"));
    if (item.valid) {
      bar.classList.add("valid");
    } else {
      bar.classList.add("invalid");
    }
    if (item.attempt === 1) {
      bar.classList.add("attempt-1");
    }
    if (item.mark) {
      bar.classList.add("mark");
    }

    const barInner = document.createElement("div");
    barInner.classList.add("bar-inner");
    barInner.style.height = `${(item.duration / maxDuration) * 96}%`;

    const tooltip = document.createElement("div");
    tooltip.classList.add("tooltip");
    tooltip.innerHTML = `
            ID: <a href="${item.url}" title="${encodeHTML(
      item.title
    )}" target="_blank">${item.id}</a><br>
            Duration: ${formatDuration(item.duration)}<br>
            Attempt: ${item.attempt}<br>
            ${item.status} ${item.symbol}
          `;

    bar.appendChild(barInner);
    bar.appendChild(tooltip);
    chartContainer.appendChild(bar);
  });

  failureRateElement.textContent = `Failure Rate: ${
    failureRatio == null ? "N/A" : `${(failureRatio * 100).toFixed(1)}%`
  }`;
}

async function init() {
  mainElement.classList.add("loading");
  await loadData();
  render();
  mainElement.classList.remove("loading");
}

// Event Listeners
function setupEventListeners() {
  Object.keys(statusFilters).forEach((status) => {
    statusFilters[status].addEventListener("change", () => {
      showStatus[status] = statusFilters[status].checked;
      render();
    });
  });

  attemptOneOnlyCheckbox.addEventListener("change", () => {
    attemptOneOnly = attemptOneOnlyCheckbox.checked;
    render();
  });

  countLimitInput.addEventListener("input", () => {
    runsToShow = parseInt(countLimitInput.value, 10) || 100;
    render();
  });

  repositorySelect.addEventListener("change", () => {
    repository = repositorySelect.value;
    init();
  });

  refreshButton.addEventListener("click", () => {
    init();
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value;
    try {
      searchRegExp = query ? new RegExp(query) : null;
    } catch (error) {
      searchRegExp = null;
    }
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      e.preventDefault();
    }
  });
}

// Initialize
setupEventListeners();
init();
